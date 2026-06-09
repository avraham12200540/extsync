using System.Diagnostics;
using System.Runtime.Versioning;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Helpers that make the one-time manual load as painless as possible (§1, §17).
/// We CANNOT silently load an unpacked extension — Chrome does not allow it. We
/// open the right page, copy the folder path, and open the folder in Explorer.
/// </summary>
[SupportedOSPlatform("windows")]
public static class ChromeHelper
{
    public const string ExtensionsUrl = "chrome://extensions/";

    public static bool OpenExtensionsPage()
    {
        // If Chrome is already running, the new tab opens in the current profile
        // window (no picker). If it is closed, Chrome may show the profile picker;
        // with some setups the picker drops the start URL and a blank tab opens —
        // that is why the wizard also offers a "copy chrome://extensions" button.
        var chrome = FindChrome();
        try
        {
            if (chrome != null)
            {
                // --new-window keeps the URL attached more reliably than a plain tab.
                Process.Start(new ProcessStartInfo(chrome, $"--new-window {ExtensionsUrl}")
                    { UseShellExecute = false });
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
