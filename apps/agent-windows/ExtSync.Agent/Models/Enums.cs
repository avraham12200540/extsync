namespace ExtSync.Agent.Models;

/// <summary>Local installation lifecycle (§7). The Agent is the source of truth
/// for these on the device.</summary>
public enum InstallationStatus
{
    Downloading,
    Staged,
    AwaitingManualLoad,
    Installed,
    UpdateAvailable,
    Updating,
    ReloadRequired,
    UpToDate,
    Paused,
    Broken,
    RollbackInProgress,
    Removed,
}

public enum UpdateStepResult
{
    Success,
    Failed,
    PendingRestart, // files locked by Chrome; will complete on restart
    RolledBack,
}

public static class ErrorCodes
{
    public const string DownloadFailed = "DOWNLOAD_FAILED";
    public const string InvalidSignature = "INVALID_SIGNATURE";
    public const string HashMismatch = "HASH_MISMATCH";
    public const string InvalidArchive = "INVALID_ARCHIVE";
    public const string InvalidManifest = "INVALID_MANIFEST";
    public const string InsufficientDiskSpace = "INSUFFICIENT_DISK_SPACE";
    public const string FileLocked = "FILE_LOCKED";
    public const string ChromeNotFound = "CHROME_NOT_FOUND";
    public const string ExtensionNotLoaded = "EXTENSION_NOT_LOADED";
    public const string NativeHostNotRegistered = "NATIVE_HOST_NOT_REGISTERED";
    public const string BridgeNotConnected = "BRIDGE_NOT_CONNECTED";
    public const string ReloadTimeout = "RELOAD_TIMEOUT";
    public const string RollbackFailed = "ROLLBACK_FAILED";
    public const string AgentUpdateRequired = "AGENT_UPDATE_REQUIRED";
    public const string PermissionApprovalRequired = "PERMISSION_APPROVAL_REQUIRED";
    public const string SizeExceeded = "SIZE_EXCEEDED";
    public const string ProjectIdMismatch = "PROJECT_ID_MISMATCH";
    public const string SequenceTooLow = "SEQUENCE_TOO_LOW";
    public const string AgentVersionRequired = "AGENT_UPDATE_REQUIRED";
}
