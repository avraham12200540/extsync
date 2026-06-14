using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.Json;
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
        // Goal: chrome://extensions must actually land in the user's profile.
        // - Chrome already running: a new window opens in the active profile - fine.
        // - Chrome CLOSED: launching `--new-window <url>` makes Chrome show the
        //   profile picker, which frequently DROPS the start URL (the user ends up
        //   on a blank/new-tab page and has to navigate to chrome://extensions by
        //   hand). To avoid that, target the last-used profile with
        //   --profile-directory: it skips the picker and keeps the URL.
        var chrome = FindChrome();
        try
        {
            if (chrome != null)
            {
                var running = Process.GetProcessesByName("chrome").Length > 0;
                var args = running
                    ? $"--new-window {ExtensionsUrl}"
                    : $"--profile-directory=\"{LastUsedProfile()}\" {ExtensionsUrl}";
                Process.Start(new ProcessStartInfo(chrome, args) { UseShellExecute = false });
                return true;
            }
            Process.Start(new ProcessStartInfo(ExtensionsUrl) { UseShellExecute = true });
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>The last-used Chrome profile directory (e.g. "Default", "Profile 1")
    /// from Chrome's Local State, so we can open a URL without the profile picker
    /// dropping it. Falls back to "Default" if anything is unreadable.</summary>
    private static string LastUsedProfile()
    {
        try
        {
            var localState = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Google", "Chrome", "User Data", "Local State");
            if (File.Exists(localState))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(localState));
                if (doc.RootElement.TryGetProperty("profile", out var prof) &&
                    prof.TryGetProperty("last_used", out var lu) &&
                    lu.ValueKind == JsonValueKind.String)
                {
                    var v = lu.GetString();
                    if (!string.IsNullOrWhiteSpace(v)) return v!;
                }
            }
        }
        catch { /* fall through to the default profile */ }
        return "Default";
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
