using System.Net.Http.Json;
using System.Text.Json;

namespace ExtSync.Agent.Services;

/// <summary>HTTP client for the ExtSync backend Agent API. Retries with backoff
/// are applied by callers; this layer keeps requests typed and adds the device token.</summary>
public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly AgentSettings _settings;

    public ApiClient(AgentSettings settings, HttpClient? http = null)
    {
        _settings = settings;
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        _http.BaseAddress = new Uri(settings.ApiBaseUrl);
    }

    private HttpRequestMessage Authed(HttpMethod method, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, path);
        if (!string.IsNullOrEmpty(_settings.DeviceToken))
            req.Headers.Add("X-Agent-Token", _settings.DeviceToken);
        if (body != null)
            req.Content = JsonContent.Create(body);
        return req;
    }

    public async Task<RegisterResult> RegisterDeviceAsync(CancellationToken ct = default)
    {
        var body = new
        {
            anonymousDeviceId = _settings.DeviceId,
            os = "windows",
            osVersion = Environment.OSVersion.Version.ToString(),
            agentVersion = _settings.AgentVersion,
        };
        var resp = await _http.PostAsJsonAsync("/agent/register", body, ct);
        resp.EnsureSuccessStatusCode();
        var result = await resp.Content.ReadFromJsonAsync<RegisterResult>(cancellationToken: ct)
                     ?? throw new InvalidOperationException("empty register response");
        _settings.DeviceToken = result.DeviceToken;
        _settings.Save();
        return result;
    }

    public async Task HeartbeatAsync(CancellationToken ct = default)
    {
        using var req = Authed(HttpMethod.Post, "/agent/heartbeat",
            new { agentVersion = _settings.AgentVersion });
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
    }

    public async Task<List<UpdateItem>> CheckUpdatesAsync(IEnumerable<CheckItem> items, CancellationToken ct = default)
    {
        using var req = Authed(HttpMethod.Post, "/agent/check-updates", new { items });
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        var doc = await resp.Content.ReadFromJsonAsync<CheckUpdatesResult>(cancellationToken: ct);
        return doc?.Updates ?? new();
    }

    public async Task<JsonElement> RegisterExtensionAsync(string token, string? extensionId, bool hasBridge, CancellationToken ct = default)
    {
        using var req = Authed(HttpMethod.Post, "/agent/register-extension",
            new { token, extensionId, hasBridge });
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
    }

    public async Task UnregisterExtensionAsync(string projectId, bool deleteFiles, CancellationToken ct = default)
    {
        using var req = Authed(HttpMethod.Post, "/agent/unregister-extension",
            new { projectId, deleteFiles });
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
    }

    public async Task ReportUpdateAsync(ReportUpdate report, CancellationToken ct = default)
    {
        using var req = Authed(HttpMethod.Post, "/agent/report-update", report);
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
    }

    public async Task<JsonElement> ResolveInstallLinkAsync(string token, CancellationToken ct = default)
    {
        using var resp = await _http.PostAsync($"/install-links/{token}/resolve", null, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
    }

    // ---- DTOs ----
    public sealed record RegisterResult(string DeviceId, string DeviceToken, string ServerTime)
    {
        public string DeviceId { get; init; } = DeviceId;
        public string DeviceToken { get; init; } = DeviceToken;
    }
    public sealed record CheckItem(string ProjectId, string Channel, long? CurrentSequence, string? CurrentVersion);
    public sealed record CheckUpdatesResult(List<UpdateItem> Updates, string ServerTime);
    public sealed class UpdateItem
    {
        public string ProjectId { get; set; } = "";
        public bool Available { get; set; }
        public string? Reason { get; set; }
        public JsonElement? Metadata { get; set; }
    }
    public sealed record ReportUpdate(string ProjectId, string ReleaseId, string IdempotencyKey,
        string? FromVersion, string ToVersion, string Status, string? ErrorCode, bool ReloadCompleted,
        string? NewStatus = null);
}
