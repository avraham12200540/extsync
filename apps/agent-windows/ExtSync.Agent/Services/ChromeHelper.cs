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
    public static bool OpenExtensionsPage()
    {
        // Prefer launching Chrome directly at chrome://extensions; fall back to default browser.
        var chrome = FindChrome();
        try
        {
            if (chrome != null)
            {
                Process.Start(new ProcessStartInfo(chrome, "chrome://extensions") { UseShellExecute = false });
                return true;
            }
            Process.Start(new ProcessStartInfo("chrome://extensions") { UseShellExecute = true });
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static void CopyPathToClipboard(string path)
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
            p.StandardInput.Write(path);
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
