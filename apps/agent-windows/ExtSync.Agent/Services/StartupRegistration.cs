using System.Diagnostics;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace ExtSync.Agent.Services;

/// <summary>"Start with Windows" via the per-user Run key (no admin needed).</summary>
[SupportedOSPlatform("windows")]
public static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "ExtSyncAgent";

    public static void Apply(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true)
                        ?? Registry.CurrentUser.CreateSubKey(RunKey);
        if (key is null) return;
        if (enabled)
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            // --minimized: boot into the tray quietly instead of popping the window.
            if (!string.IsNullOrEmpty(exe)) key.SetValue(ValueName, $"\"{exe}\" --minimized");
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}
