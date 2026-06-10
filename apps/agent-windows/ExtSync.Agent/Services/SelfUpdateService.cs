using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using ExtSync.Agent.Crypto;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Agent self-update (§28). Fully automatic and silent: polls the server for a
/// newer signed build, verifies SHA-256 + the platform's Ed25519 signature with
/// the same baked-in keys used for extensions, then runs the Inno installer in
/// /VERYSILENT mode and relaunches. Refuses anything that fails verification -
/// in that case the current version simply keeps running.
/// </summary>
public sealed class SelfUpdateService
{
    private readonly AgentSettings _settings;
    private readonly ReleaseVerifier _verifier;
    private readonly ILogger _log;
    private readonly Action<string, string>? _notify;

    // Own client: installer downloads can far exceed the shared client's timeout.
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(15) };

    public SelfUpdateService(AgentSettings settings, ReleaseVerifier verifier, ILogger log,
                             Action<string, string>? notify = null)
    {
        _settings = settings; _verifier = verifier; _log = log; _notify = notify;
    }

    /// <summary>Checks for a newer build and applies it. Returns true when an
    /// update was launched - the app is shutting down and will relaunch updated.</summary>
    public async Task<bool> CheckAndApplyAsync(CancellationToken ct = default)
    {
        var channel = _settings.UseAgentBeta ? "beta" : "stable";
        var url = $"{_settings.ApiBaseUrl}/agent/self-update" +
                  $"?channel={channel}&current_version={Uri.EscapeDataString(_settings.AgentVersion)}";
        using var resp = await _http.GetAsync(url, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        if (!root.TryGetProperty("updateAvailable", out var ua) || !ua.GetBoolean())
            return false;

        var version = root.GetProperty("version").GetString()!;
        var downloadUrl = root.GetProperty("downloadUrl").GetString()!;
        var sha256 = root.GetProperty("sha256").GetString()!.ToLowerInvariant();
        var signature = root.GetProperty("signature").GetString()!;
        var keyId = root.GetProperty("keyId").GetString()!;

        // The server signed the canonical JSON of exactly this object (admin
        // register endpoint); rebuilding it locally pins version+hash to the key.
        var signedMeta = JsonSerializer.SerializeToElement(new Dictionary<string, string>
        {
            ["keyId"] = keyId,
            ["sha256"] = sha256,
            ["signature"] = signature,
            ["type"] = "agent-update",
            ["version"] = version,
        });
        if (!_verifier.VerifyMetadata(signedMeta))
        {
            _log.Warning("self-update: Ed25519 verification FAILED for {Version} - refusing", version);
            return false;
        }

        AgentPaths.EnsureCreated();
        var installer = Path.Combine(AgentPaths.TempDir, $"ExtSyncAgentSetup-{version}.exe");
        _log.Information("self-update: downloading {Version}", version);
        await using (var src = await _http.GetStreamAsync(downloadUrl, ct))
        await using (var dst = File.Create(installer))
            await src.CopyToAsync(dst, ct);

        if (!ReleaseVerifier.VerifySha256(installer, sha256))
        {
            _log.Warning("self-update: sha256 mismatch for {Version} - refusing", version);
            try { File.Delete(installer); } catch { /* best effort */ }
            return false;
        }

        _log.Information("self-update: applying {Version}", version);
        _notify?.Invoke("ExtSync Agent", $"מתקין עדכון לגרסה {version}…");

        // Exit first (mutex released, files unlocked), install silently, relaunch.
        // `&` in cmd is sequential, and ping serves as a dependency-free sleep.
        var appExe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "ExtSyncAgent.exe");
        var args = "/c ping -n 3 127.0.0.1 >nul & " +
                   $"\"{installer}\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART & " +
                   "ping -n 2 127.0.0.1 >nul & " +
                   $"start \"\" \"{appExe}\"";
        Process.Start(new ProcessStartInfo("cmd.exe", args)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            WorkingDirectory = AgentPaths.TempDir,
        });

        await Task.Delay(500, CancellationToken.None);
        Application.Current.Dispatcher.Invoke(() => Application.Current.Shutdown());
        return true;
    }
}
