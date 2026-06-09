using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Local IPC between the Native Messaging Host (which talks to Chrome over stdio)
/// and the Agent. Newline-delimited JSON over a per-user named pipe. The Agent
/// uses this to deliver a verified <c>update.reload_ready</c> (with a one-time
/// nonce) to an extension's Bridge and to await its ack (§10, §27, ADR-0006).
///
/// Multi-profile support: each Chrome profile that runs the extension spawns its
/// own native-host process and thus its own pipe connection. Connections are
/// tracked as a SET per projectId, and reload requests are broadcast to all of
/// them — the extension folder on disk is shared, so every profile must reload.
/// </summary>
public sealed class PipeServer : IAsyncDisposable
{
    public const string PipeName = "extsync-agent";

    private readonly ILogger _log;
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<BridgeConnection, byte>> _byProject = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pendingReloads = new();

    public event Action<string, string>? BridgeConnected;     // (projectId, extensionId)
    public event Action<string>? BridgeDisconnected;          // (projectId) — last instance gone

    public PipeServer(ILogger log) => _log = log;

    public bool IsBridgeConnected(string projectId) =>
        _byProject.TryGetValue(projectId, out var set) && !set.IsEmpty;

    /// <summary>How many Chrome profiles currently have this extension connected.</summary>
    public int ConnectedInstanceCount(string projectId) =>
        _byProject.TryGetValue(projectId, out var set) ? set.Count : 0;

    public void Start()
    {
        _ = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var server = new NamedPipeServerStream(
                    PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync(_cts.Token);
                _ = Task.Run(() => HandleClientAsync(server));
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.Warning(ex, "pipe accept failed; retrying");
                await Task.Delay(1000);
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream stream)
    {
        var conn = new BridgeConnection(stream);
        string? projectId = null;
        try
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, false, 8192, leaveOpen: true);
            while (!_cts.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(_cts.Token);
                if (line is null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;
                JsonElement msg;
                try { msg = JsonSerializer.Deserialize<JsonElement>(line); }
                catch (JsonException) { continue; }
                projectId = HandleMessage(msg, conn, projectId);
            }
        }
        catch (Exception ex) { _log.Debug(ex, "bridge connection ended"); }
        finally
        {
            if (projectId != null) RemoveConnection(projectId, conn);
            await stream.DisposeAsync();
        }
    }

    private void RemoveConnection(string projectId, BridgeConnection conn)
    {
        if (_byProject.TryGetValue(projectId, out var set))
        {
            set.TryRemove(conn, out _);
            if (set.IsEmpty && _byProject.TryRemove(projectId, out _))
            {
                BridgeDisconnected?.Invoke(projectId);
                _log.Information("last bridge instance disconnected project={Project}", projectId);
            }
        }
    }

    private string? HandleMessage(JsonElement msg, BridgeConnection conn, string? projectId)
    {
        if (!msg.TryGetProperty("type", out var typeEl)) return projectId;
        var type = typeEl.GetString();
        var pid = msg.TryGetProperty("projectId", out var p) ? p.GetString() : projectId;
        var extId = msg.TryGetProperty("extensionId", out var e) ? e.GetString() : "";

        switch (type)
        {
            case "extension.register":
            case "extension.status":
                if (!string.IsNullOrEmpty(pid))
                {
                    var set = _byProject.GetOrAdd(pid, _ => new ConcurrentDictionary<BridgeConnection, byte>());
                    if (set.TryAdd(conn, 0))
                        _log.Information("bridge connected project={Project} ext={Ext} instances={Count}",
                            pid, extId, set.Count);
                    BridgeConnected?.Invoke(pid, extId ?? "");
                }
                return pid;

            case "update.reload_ack":
                if (msg.TryGetProperty("payload", out var pl) &&
                    pl.TryGetProperty("nonce", out var nonceEl))
                {
                    var nonce = nonceEl.GetString();
                    if (nonce != null && _pendingReloads.TryRemove(nonce, out var tcs))
                        tcs.TrySetResult(true);
                }
                return pid;

            default:
                return pid;
        }
    }

    /// <summary>
    /// Ask every connected instance (every Chrome profile) of the project's Bridge
    /// to reload, then await the first ack (verified by nonce). All instances share
    /// the same on-disk folder, so each must reload itself; one ack is enough to
    /// confirm the new version is live (the rest reload independently).
    /// </summary>
    public async Task<bool> RequestReloadAsync(string projectId, string version, TimeSpan timeout)
    {
        if (!_byProject.TryGetValue(projectId, out var set) || set.IsEmpty)
            return false; // no Bridge connected -> caller marks Pending Restart

        var nonce = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingReloads[nonce] = tcs;

        var message = new
        {
            protocolVersion = 1,
            requestId = Guid.NewGuid().ToString("N"),
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            projectId,
            extensionId = "",
            type = "update.reload_ready",
            payload = new { nonce, version },
        };

        var delivered = 0;
        foreach (var conn in set.Keys)
        {
            try
            {
                await conn.SendAsync(message);
                delivered++;
            }
            catch (Exception ex)
            {
                _log.Warning(ex, "failed to send reload to one bridge instance project={Project}", projectId);
                RemoveConnection(projectId, conn);
            }
        }
        if (delivered == 0)
        {
            _pendingReloads.TryRemove(nonce, out _);
            return false;
        }
        _log.Information("reload_ready broadcast project={Project} instances={Count}", projectId, delivered);

        using var timeoutCts = new CancellationTokenSource(timeout);
        await using var reg = timeoutCts.Token.Register(() => tcs.TrySetResult(false));
        var acked = await tcs.Task;
        _pendingReloads.TryRemove(nonce, out _);
        return acked;
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        await Task.CompletedTask;
    }

    private sealed class BridgeConnection
    {
        private readonly Stream _stream;
        private readonly SemaphoreSlim _writeLock = new(1, 1);
        public BridgeConnection(Stream stream) => _stream = stream;

        public async Task SendAsync(object message)
        {
            var json = JsonSerializer.Serialize(message) + "\n";
            var bytes = Encoding.UTF8.GetBytes(json);
            await _writeLock.WaitAsync();
            try
            {
                await _stream.WriteAsync(bytes);
                await _stream.FlushAsync();
            }
            finally { _writeLock.Release(); }
        }
    }
}
