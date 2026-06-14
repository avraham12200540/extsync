using System.Diagnostics;
using System.Globalization;
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
            // Decide on an actual browser WINDOW, not just a chrome.exe process:
            // Chrome keeps background processes alive with NO window open (common),
            // so a process check wrongly concludes a window exists and fires a URL
            // that the profile picker then drops. If a browser window is open, open
            // the tab in it; otherwise launch Chrome (its picker) and open the
            // extensions tab once a window appears.
            if (ChromeWindowTitles().Any(LooksLikeBrowserWindow))
            {
                Log.Information("OpenExtensions: a browser window is open; opening the extensions tab now");
                LaunchExtensions(chrome);
            }
            else
            {
                Log.Information("OpenExtensions: no browser window; launching Chrome (picker) then waiting for a window");
                Process.Start(new ProcessStartInfo(chrome) { UseShellExecute = false });
                _ = OpenExtensionsWhenReadyAsync(chrome);
            }
            return true;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "OpenExtensions: failed to open the extensions page");
            return false;
        }
    }

    private static void LaunchExtensions(string chrome) =>
        Process.Start(new ProcessStartInfo(chrome, ExtensionsUrl) { UseShellExecute = false });

    /// <summary>After the picker is shown, wait for the user to pick a profile -
    /// i.e. a real Chrome browser window to appear - then open the extensions tab
    /// in it. Locale-independent (works with Hebrew/RTL titles). Logs the window
    /// titles it sees so a missed detection can be diagnosed from the agent log.
    /// Falls back to a best-effort open if nothing is detected in time.</summary>
    private static async Task OpenExtensionsWhenReadyAsync(string chrome)
    {
        var seen = new HashSet<string>();
        for (var i = 0; i < 50; i++) // ~25s
        {
            await Task.Delay(500).ConfigureAwait(false);
            var titles = ChromeWindowTitles();
            foreach (var t in titles)
                if (seen.Add(t)) Log.Information("OpenExtensions: Chrome window title seen: {Title}", t);
            if (titles.Any(LooksLikeBrowserWindow))
            {
                Log.Information("OpenExtensions: browser window detected; opening extensions page");
                try { LaunchExtensions(chrome); } catch (Exception ex) { Log.Warning(ex, "OpenExtensions: launch failed"); }
                return;
            }
        }
        Log.Information("OpenExtensions: no browser window detected in time; opening extensions page anyway");
        try { LaunchExtensions(chrome); } catch (Exception ex) { Log.Warning(ex, "OpenExtensions: fallback launch failed"); }
    }

    private static List<string> ChromeWindowTitles()
    {
        var titles = new List<string>();
        foreach (var p in Process.GetProcessesByName("chrome"))
        {
            try
            {
                if (p.MainWindowHandle != IntPtr.Zero && !string.IsNullOrEmpty(p.MainWindowTitle))
                    titles.Add(p.MainWindowTitle);
            }
            catch { /* the process may have exited mid-iteration */ }
            finally { p.Dispose(); }
        }
        return titles;
    }

    /// <summary>True for a Chrome *browser* window, excluding the bare profile
    /// picker. Strips the bidi/formatting marks Chrome injects into RTL (Hebrew)
    /// window titles, then matches the non-localized product name plus a page-title
    /// separator - so "&lt;page&gt; - Google Chrome" matches in any UI language while
    /// a bare "Google Chrome" picker title does not.</summary>
    private static bool LooksLikeBrowserWindow(string title)
    {
        if (string.IsNullOrEmpty(title)) return false;
        var clean = new string(title.Where(
            c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.Format).ToArray()).Trim();
        return clean.Contains("Google Chrome", StringComparison.Ordinal)
            && clean.Contains(" - ", StringComparison.Ordinal);
    }

    /// <summary>The Chrome profiles (directory + display name) from Local State,
    /// in Chrome's display order. Empty if Chrome/Local State can't be read.</summary>
    public static List<(string Dir, string Name)> GetProfiles()
    {
        var result = new List<(string, string)>();
        try
        {
            var localState = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Google", "Chrome", "User Data", "Local State");
            if (!File.Exists(localState)) return result;
            using var doc = JsonDocument.Parse(File.ReadAllText(localState));
            if (!doc.RootElement.TryGetProperty("profile", out var profile)) return result;
            if (!profile.TryGetProperty("info_cache", out var cache) || cache.ValueKind != JsonValueKind.Object)
                return result;

            var map = new Dictionary<string, string>();
            foreach (var entry in cache.EnumerateObject())
            {
                var name = entry.Value.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                    ? n.GetString() : null;
                map[entry.Name] = string.IsNullOrWhiteSpace(name) ? entry.Name : name!;
            }
            // Preserve Chrome's own display order when available.
            if (profile.TryGetProperty("profiles_order", out var order) && order.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in order.EnumerateArray())
                {
                    var dir = el.GetString();
                    if (dir != null && map.Remove(dir, out var nm)) result.Add((dir, nm));
                }
            }
            foreach (var kv in map) result.Add((kv.Key, kv.Value));
        }
        catch { /* unreadable -> empty list, caller falls back */ }
        return result;
    }

    /// <summary>Open chrome://extensions in a SPECIFIC profile. Reliable and
    /// race-free whether Chrome is open or closed (no dependency on the native
    /// profile picker). Falls back to the generic open if no profile is given.</summary>
    public static bool OpenExtensionsInProfile(string profileDir)
    {
        var chrome = FindChrome();
        if (chrome == null || string.IsNullOrWhiteSpace(profileDir)) return OpenExtensionsPage();
        try
        {
            Log.Information("OpenExtensions: target profile {Profile}", profileDir);
            // Open the profile's WINDOW first (no URL). Passing a chrome:// URL while
            // a profile window is cold-starting drops it (blank tab) - so we wait for
            // a browser window to exist, then send chrome://extensions into the
            // already-running instance (reliable), targeted at the chosen profile.
            Process.Start(new ProcessStartInfo(
                chrome, $"--profile-directory=\"{profileDir}\"") { UseShellExecute = false });
            _ = OpenInProfileWhenReadyAsync(chrome, profileDir);
            return true;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "OpenExtensions: open-in-profile failed");
            return false;
        }
    }

    private static async Task OpenInProfileWhenReadyAsync(string chrome, string profileDir)
    {
        // --new-window + a chrome:// URL is the combination Chrome honors reliably,
        // but only against a RUNNING instance; so wait for a window, settle briefly
        // (firing the instant a window appears also gets dropped), then send.
        var args = $"--profile-directory=\"{profileDir}\" --new-window {ExtensionsUrl}";
        for (var i = 0; i < 40; i++) // ~20s
        {
            await Task.Delay(500).ConfigureAwait(false);
            if (ChromeWindowTitles().Any(LooksLikeBrowserWindow))
            {
                await Task.Delay(1500).ConfigureAwait(false);
                Log.Information("OpenExtensions: window ready; opening extensions in profile {Profile}", profileDir);
                try { Process.Start(new ProcessStartInfo(chrome, args) { UseShellExecute = false }); }
                catch (Exception ex) { Log.Warning(ex, "OpenExtensions: profile open failed"); }
                return;
            }
        }
        Log.Information("OpenExtensions: window not detected; opening extensions in profile {Profile} anyway", profileDir);
        try { Process.Start(new ProcessStartInfo(chrome, args) { UseShellExecute = false }); }
        catch (Exception ex) { Log.Warning(ex, "OpenExtensions: fallback profile open failed"); }
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
