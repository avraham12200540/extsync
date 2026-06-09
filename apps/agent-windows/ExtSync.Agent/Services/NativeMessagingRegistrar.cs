using System.Runtime.Versioning;
using System.Text.Json;
using Microsoft.Win32;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Registers the Native Messaging Host under HKCU (per-user, no admin) and keeps
/// its <c>allowed_origins</c> in sync with the managed extension ids (ADR-0006).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class NativeMessagingRegistrar
{
    public const string HostName = "com.extsync.agent";
    private readonly ILogger _log;
    private readonly string _hostExePath;
    private readonly string _manifestPath;

    public NativeMessagingRegistrar(ILogger log, string hostExePath)
    {
        _log = log;
        _hostExePath = hostExePath;
        _manifestPath = Path.Combine(AgentPaths.NativeHostDir, HostName + ".json");
    }

    private static readonly string[] BrowserKeys =
    {
        @"Software\Google\Chrome\NativeMessagingHosts\" + HostName,
        @"Software\Microsoft\Edge\NativeMessagingHosts\" + HostName,
        @"Software\Chromium\NativeMessagingHosts\" + HostName,
    };

    /// <summary>Write the host manifest and point the browsers' HKCU keys at it.</summary>
    public void Register(IEnumerable<string> extensionIds)
    {
        AgentPaths.EnsureCreated();
        WriteManifest(extensionIds);
        foreach (var key in BrowserKeys)
        {
            using var rk = Registry.CurrentUser.CreateSubKey(key);
            rk?.SetValue(null, _manifestPath); // (Default) = path to the host manifest
        }
        _log.Information("native messaging host registered (HKCU)");
    }

    /// <summary>Rewrite allowed_origins when an extension is added/removed.</summary>
    public void UpdateAllowedOrigins(IEnumerable<string> extensionIds)
    {
        WriteManifest(extensionIds);
        _log.Information("native host allowed_origins updated");
    }

    private void WriteManifest(IEnumerable<string> extensionIds)
    {
        var origins = extensionIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => $"chrome-extension://{id}/")
            .Distinct()
            .ToArray();

        var manifest = new
        {
            name = HostName,
            description = "ExtSync Agent Native Messaging Host",
            path = _hostExePath,
            type = "stdio",
            allowed_origins = origins,
        };
        File.WriteAllText(_manifestPath,
            JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));
    }

    public void Unregister()
    {
        foreach (var key in BrowserKeys)
        {
            try { Registry.CurrentUser.DeleteSubKey(key, throwOnMissingSubKey: false); }
            catch (Exception ex) { _log.Warning(ex, "failed to delete registry key {Key}", key); }
        }
    }
}
