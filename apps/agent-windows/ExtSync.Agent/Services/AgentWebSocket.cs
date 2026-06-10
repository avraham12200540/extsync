using System.Net.WebSockets;
using System.Text;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Maintains a WebSocket to the server for push "check now" nudges (§6). When a
/// push arrives the Agent runs a normal check-updates (the idempotent source of
/// truth). Reconnects with exponential backoff; the periodic poller is the
/// fallback when the socket is down (POC #12, #13).
/// </summary>
public sealed class AgentWebSocket : IAsyncDisposable
{
    private readonly AgentSettings _settings;
    private readonly Func<Task> _onPush;
    private readonly ILogger _log;
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;

    public AgentWebSocket(AgentSettings settings, Func<Task> onPush, ILogger log)
    {
        _settings = settings; _onPush = onPush; _log = log;
    }

    public void Start() => _loop = Task.Run(RunAsync);

    private async Task RunAsync()
    {
        var attempt = 0;
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrEmpty(_settings.DeviceToken))
                {
                    await Task.Delay(TimeSpan.FromSeconds(10), _cts.Token);
                    continue;
                }
                using var ws = new ClientWebSocket();
                var uri = new Uri($"{_settings.WsBaseUrl.TrimEnd('/')}/agent/events?token={_settings.DeviceToken}");
                await ws.ConnectAsync(uri, _cts.Token);
                attempt = 0;
                _log.Information("agent websocket connected");
                _ = _onPush();  // catch up on anything published while we were offline
                await ReceiveLoop(ws);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                attempt++;
                var delay = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, Math.Min(attempt, 6))));
                _log.Debug(ex, "websocket disconnected; reconnecting in {Delay}s", delay.TotalSeconds);
                try { await Task.Delay(delay, _cts.Token); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task ReceiveLoop(ClientWebSocket ws)
    {
        var buffer = new byte[8192];
        // Periodic ping to keep the socket alive and let the server send.
        _ = Task.Run(async () =>
        {
            while (ws.State == WebSocketState.Open && !_cts.IsCancellationRequested)
            {
                try
                {
                    var ping = Encoding.UTF8.GetBytes("{\"type\":\"ping\"}");
                    await ws.SendAsync(ping, WebSocketMessageType.Text, true, _cts.Token);
                    await Task.Delay(TimeSpan.FromSeconds(45), _cts.Token);
                }
                catch { break; }
            }
        });

        while (ws.State == WebSocketState.Open && !_cts.IsCancellationRequested)
        {
            var result = await ws.ReceiveAsync(buffer, _cts.Token);
            if (result.MessageType == WebSocketMessageType.Close) break;
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (text.Contains("\"push\"") || text.Contains("update_available") || text.Contains("rollback"))
            {
                _log.Information("push received; triggering update check");
                try { await _onPush(); } catch (Exception ex) { _log.Warning(ex, "onPush failed"); }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        if (_loop != null) { try { await _loop; } catch { /* ignore */ } }
    }
}
