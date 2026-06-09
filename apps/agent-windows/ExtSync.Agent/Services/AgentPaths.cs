namespace ExtSync.Agent.Services;

/// <summary>The on-disk layout under %LOCALAPPDATA%\ExtSync (§13). Created on first run.</summary>
public static class AgentPaths
{
    public static string Root { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ExtSync");

    public static string AgentDir => Path.Combine(Root, "Agent");
    public static string NativeHostDir => Path.Combine(Root, "NativeHost");
    public static string DataDir => Path.Combine(Root, "Data");
    public static string LogsDir => Path.Combine(Root, "Logs");
    public static string ExtensionsDir => Path.Combine(Root, "Extensions");
    public static string TempDir => Path.Combine(Root, "Temp");

    public static string DatabasePath => Path.Combine(DataDir, "extsync.db");

    public static string ExtensionDir(string projectId) => Path.Combine(ExtensionsDir, projectId);

    public static void EnsureCreated()
    {
        foreach (var dir in new[] { Root, AgentDir, NativeHostDir, DataDir, LogsDir, ExtensionsDir, TempDir })
            Directory.CreateDirectory(dir);
    }
}
