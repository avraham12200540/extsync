using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using ExtSync.Agent.Models;
using ExtSync.Agent.Services;
using Serilog;

namespace ExtSync.Agent.Views;

public partial class InstallWizardWindow : Window
{
    private readonly string _token;
    private readonly JsonElement _resolved;
    private readonly AgentController _controller;
    private readonly ILogger _log;
    private LocalInstallation? _installation;

    public InstallWizardWindow(string token, JsonElement resolved, AgentController controller, ILogger log)
    {
        InitializeComponent();
        _token = token;
        _resolved = resolved;
        _controller = controller;
        _log = log;
        PopulateConfirm();
    }

    private string Str(string prop) =>
        _resolved.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private void PopulateConfirm()
    {
        TxtName.Text = Str("name");
        TxtDeveloper.Text = L10n.F("Wiz.By", Str("developerName"));
        var version = Str("version");
        var channel = Str("channel");
        TxtMeta.Text = L10n.F("Wiz.Meta", string.IsNullOrEmpty(version) ? "-" : version, channel);
        TxtDescription.Text = Str("shortDescription");

        if (_resolved.TryGetProperty("permissions", out var perms) &&
            perms.TryGetProperty("permissions", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            PermsList.ItemsSource = list.EnumerateArray().Select(e => e.GetString()).ToList();
        }
        if (_resolved.TryGetProperty("permissions", out var p2) &&
            p2.TryGetProperty("hostPermissions", out var hosts) && hosts.ValueKind == JsonValueKind.Array)
        {
            var h = hosts.EnumerateArray().Select(e => e.GetString()).Where(s => !string.IsNullOrEmpty(s));
            var joined = string.Join(", ", h);
            TxtHosts.Text = string.IsNullOrEmpty(joined) ? "" : L10n.F("Wiz.Hosts", joined);
        }

        var usable = !_resolved.TryGetProperty("usable", out var u) || u.GetBoolean();
        if (!usable)
        {
            BtnInstall.IsEnabled = false;
            TxtDescription.Text = L10n.T("Wiz.Unusable");
        }
    }

    private async void OnInstall(object sender, RoutedEventArgs e)
    {
        BtnInstall.IsEnabled = false;
        try
        {
            _installation = await _controller.InstallFromTokenAsync(_token, _resolved);
            // We no longer try to auto-open chrome://extensions - Chrome drops the URL
            // unreliably across profiles/cold starts (the blank-tab saga). Instead the
            // guide explains it in plain steps + a short video, the folder path is
            // pre-copied for "Load unpacked", and "Copy chrome://extensions" is one click.
            ChromeHelper.CopyPathToClipboard(_installation.ActivePath);
            TxtFolder.Text = L10n.F("Wiz.Folder", _installation.ActivePath);
            ShowGuide();
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "install failed");
            MessageBox.Show(L10n.F("Wiz.InstallFailed", ex.Message), "ExtSync",
                MessageBoxButton.OK, MessageBoxImage.Error);
            BtnInstall.IsEnabled = true;
        }
    }

    private void ShowGuide()
    {
        ConfirmPanel.Visibility = Visibility.Collapsed;
        GuidePanel.Visibility = Visibility.Visible;
    }

    private void OnOpenGifLargePoster(object sender, MouseButtonEventArgs e) => OpenGuideGifLarge();
    private void OnOpenGifLargeClick(object sender, RoutedEventArgs e) => OpenGuideGifLarge();

    // Show the full screen-recording guide in a large, closable window: extract the
    // embedded GIF to a temp file and open it in the OS default viewer (which animates
    // it correctly - we deliberately do not animate GIFs inside WPF).
    private void OpenGuideGifLarge()
    {
        try
        {
            var dest = Path.Combine(Path.GetTempPath(), "extsync-load-extension.gif");
            var res = Application.GetResourceStream(new Uri("Assets/load-extension.gif", UriKind.Relative));
            if (res == null) return;
            using (var src = res.Stream)
            using (var fs = File.Create(dest))
                src.CopyTo(fs);
            Process.Start(new ProcessStartInfo(dest) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "open guide gif failed");
        }
    }
    private void OnCopyPath(object sender, RoutedEventArgs e)
    {
        if (_installation != null) ChromeHelper.CopyPathToClipboard(_installation.ActivePath);
    }
    private void OnOpenFolder(object sender, RoutedEventArgs e)
    {
        if (_installation != null) ChromeHelper.OpenFolder(_installation.ActivePath);
    }

    private void OnCopyUrl(object sender, RoutedEventArgs e)
    {
        ChromeHelper.CopyExtensionsUrl();
        TxtGuideStatus.Text = L10n.T("Wiz.CopiedStatus");
    }

    private void OnConfirmLoaded(object sender, RoutedEventArgs e)
    {
        if (_installation == null) return;
        _controller.MarkManuallyLoaded(_installation.ProjectId);
        TxtGuideStatus.Text = L10n.T("Wiz.LoadedStatus");
        BtnConfirmLoaded.IsEnabled = false;
    }

    private void OnHelp(object sender, RoutedEventArgs e)
    {
        MessageBox.Show(L10n.T("Wiz.HelpBody"), L10n.T("Wiz.HelpTitle"),
            MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OnCancel(object sender, RoutedEventArgs e) => Close();
}
