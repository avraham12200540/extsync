using System.Diagnostics;
using System.Runtime.Versioning;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Helpers that make the one-time manual load as painless as possible (§1, §17).
/// We CANNOT silently load an unpacked extension — Chrome does not allow it. We
/// open chrome://extensions in the user's profile and copy the folder path to the
/// clipboard. Opening the folder in Explorer is available on demand (a button),
/// not automatic, so the install click only brings up the browser.
/// </summary>
[SupportedOSPlatform("windows")]
public static class ChromeHelper
{
    public const string ExtensionsUrl = "chrome://extensions/";

    public static bool OpenExtensionsPage()
    {
        // We keep Chrome's profile picker intact (the user chooses a profile), but
        // the picker drops a start URL - so `chrome --new-window <url>` on a CLOSED
        // Chrome lands the user on a blank tab. Strategy:
        //   * Chrome already running -> open the page in the active profile now.
        //   * Chrome closed -> launch plainly so the picker appears as usual, then
        //     once a real browser window exists (the user has picked a profile)
        //     open the extensions tab in it. A browser window's title ends with
        //     " - Google Chrome"; the bare picker's does not, so we never fire
        //     while the picker is still up, and we open exactly one extensions tab.
        var chrome = FindChrome();
        if (chrome == null)
        {
            try { Process.Start(new ProcessStartInfo(ExtensionsUrl) { UseShellExecute = true }); return true; }
            catch { return false; }
        }
        try
        {
            if (IsChromeRunning())
            {
                LaunchExtensions(chrome);
            }
            else
            {
                // Bring up Chrome (and its profile picker) without a URL...
                Process.Start(new ProcessStartInfo(chrome) { UseShellExecute = false });
                // ...then open the extensions page once the user has a window.
                _ = OpenExtensionsWhenReadyAsync(chrome);
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsChromeRunning() => Process.GetProcessesByName("chrome").Length > 0;

    private static void LaunchExtensions(string chrome) =>
        Process.Start(new ProcessStartInfo(chrome, ExtensionsUrl) { UseShellExecute = false });

    /// <summary>After the picker is shown, wait (up to ~45s) for the user to pick a
    /// profile - i.e. a real Chrome browser window to appear - then open the
    /// extensions tab in it. Falls back to a best-effort open if none is detected.</summary>
    private static async Task OpenExtensionsWhenReadyAsync(string chrome)
    {
        for (var i = 0; i < 60; i++)
        {
            await Task.Delay(750).ConfigureAwait(false);
            if (HasChromeBrowserWindow())
            {
                try { LaunchExtensions(chrome); } catch { /* non-fatal */ }
                return;
            }
        }
        try { LaunchExtensions(chrome); } catch { /* non-fatal */ }
    }

    /// <summary>True once a Chrome *browser* window exists (title ends with
    /// " - Google Chrome"), which excludes the bare profile picker.</summary>
    private static bool HasChromeBrowserWindow()
    {
        foreach (var p in Process.GetProcessesByName("chrome"))
        {
            try
            {
                if (p.MainWindowHandle != IntPtr.Zero &&
                    p.MainWindowTitle.EndsWith(" - Google Chrome", StringComparison.Ordinal))
                    return true;
            }
            catch { /* the process may have exited mid-iteration */ }
            finally { p.Dispose(); }
        }
        return false;
    }

    public static void CopyPathToClipboard(string path) => CopyText(path);

    public static void CopyExtensionsUrl() => CopyText(ExtensionsUrl);

    public static void CopyText(string text)
    {
        // Use clip.exe to avoid an STA/WPF clipboard dependency from background threads.
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c clip")
            {
                RedirectStandardInput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            p.StandardInput.Write(text);
            p.StandardInput.Close();
            p.WaitForExit(2000);
        }
        catch { /* non-fatal */ }
    }

    public static void OpenFolder(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
        }
        catch { /* non-fatal */ }
    }

    public static string? FindChrome()
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    public static bool IsChromeInstalled() => FindChrome() != null;
}
