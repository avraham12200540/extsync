using System.Text.Json;

namespace ExtSync.Agent.Services;

/// <summary>User-configurable settings (§18 settings screen), persisted to JSON.</summary>
public sealed class AgentSettings
{
    public string ApiBaseUrl { get; set; } = "https://api.extsync.com";
    public string WsBaseUrl { get; set; } = "wss://api.extsync.com";
    public bool StartWithWindows { get; set; } = true;
    public bool AutoCheck { get; set; } = true;
    public int CheckIntervalHours { get; set; } = 4;     // default: every 4 hours (§6)
    public bool AutoUpdate { get; set; } = true;
    public bool DownloadInBackground { get; set; } = true;
    public bool WindowsNotifications { get; set; } = true;
    public int RollbackVersionsToKeep { get; set; } = 2; // keep >= 2 previous (§14)
    public bool UseAgentBeta { get; set; }
    public bool OptInTelemetry { get; set; }             // opt-in only (§29)
    public bool DarkMode { get; set; }
    public string DeviceId { get; set; } = "";           // random, not hardware-derived (§2)
    public string? DeviceToken { get; set; }
    public string? UserDeviceToken { get; set; }         // set after account pairing
    public string AgentVersion { get; set; } = "1.0.0";

    private static string FilePath => Path.Combine(AgentPaths.DataDir, "settings.json");

    public static AgentSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var s = JsonSerializer.Deserialize<AgentSettings>(File.ReadAllText(FilePath));
                if (s != null)
                {
                    if (string.IsNullOrEmpty(s.DeviceId)) s.DeviceId = NewDeviceId();
                    return s;
                }
            }
        }
        catch
        {
            // Corrupt settings should not block startup; fall back to defaults.
        }
        var fresh = new AgentSettings { DeviceId = NewDeviceId() };
        fresh.Save();
        return fresh;
    }

    public void Save()
    {
        AgentPaths.EnsureCreated();
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this,
            new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Random device id (NOT derived from hardware), per privacy rules (§2, §29).</summary>
    public static string NewDeviceId() => "dvc_" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N")[..8];
}
