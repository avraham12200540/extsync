namespace ExtSync.Agent.Models;

/// <summary>The Agent's local record of a managed extension (persisted in SQLite).</summary>
public sealed class LocalInstallation
{
    public string ProjectId { get; set; } = "";
    public string Name { get; set; } = "";
    public string DeveloperName { get; set; } = "";
    public string? IconUrl { get; set; }
    public string ExtensionId { get; set; } = "";
    public string Channel { get; set; } = "stable";
    public string CurrentVersion { get; set; } = "";
    public string? CurrentReleaseId { get; set; }
    public long CurrentSequence { get; set; }
    public InstallationStatus Status { get; set; } = InstallationStatus.AwaitingManualLoad;
    public bool HasBridge { get; set; }
    public bool UpdatesPaused { get; set; }
    public bool BridgeConnected { get; set; }
    public DateTimeOffset? LastCheckedAt { get; set; }
    public DateTimeOffset? LastUpdatedAt { get; set; }
    public string FolderPath { get; set; } = "";        // %LOCALAPPDATA%\ExtSync\Extensions\{projectId}\active
    public string? LastError { get; set; }

    /// <summary>Folder Chrome loads as the unpacked extension (the stable path).</summary>
    public string ActivePath => Path.Combine(FolderPath, "active");
    public string StagingPath => Path.Combine(FolderPath, "staging");
    public string RollbackPath => Path.Combine(FolderPath, "rollback");
}
