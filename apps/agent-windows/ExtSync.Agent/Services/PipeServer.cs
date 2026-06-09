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
/// nonce) to a specific extension's Bridge and to await its ack (§10, §27, ADR-0006).
/// </summary>
public sealed class PipeServer : IAsyncDisposable
{
    public const string PipeName = "extsync-agent";

    private readonly ILogger _log;
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<string, BridgeConnection> _byProject = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pendingReloads = new();

    public event Action<string, string>? BridgeConnected;     // (projectId, extensionId)
    public event Action<string>? BridgeDisconnected;          // (projectId)

    public PipeServer(ILogger log) => _log = log;

    public bool IsBridgeConnected(string projectId) => _byProject.ContainsKey(projectId);

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
            if (projectId != null)
            {
                _byProject.TryRemove(projectId, out _);
                BridgeDisconnected?.Invoke(projectId);
            }
            await stream.DisposeAsync();
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
                    _byProject[pid] = conn;
                    BridgeConnected?.Invoke(pid, extId ?? "");
                    _log.Information("bridge connected project={Project} ext={Ext}", pid, extId);
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

    /// <summary>Ask the project's Bridge to reload, then await its ack (verified by nonce).</summary>
    public async Task<bool> RequestReloadAsync(string projectId, string version, TimeSpan timeout)
    {
        if (!_byProject.TryGetValue(projectId, out var conn))
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
        try
        {
            await conn.SendAsync(message);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "failed to send reload to bridge project={Project}", projectId);
            _pendingReloads.TryRemove(nonce, out _);
            return false;
        }

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
