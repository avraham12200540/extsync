using System.Text.Json;
using System.Windows;
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
            // Prepare the guided manual load: copy the folder path and open the
            // extensions page in the user's profile. We deliberately do NOT pop
            // open File Explorer - only the browser should appear. (The path is on
            // the clipboard, and the guide panel still has an "Open folder" button.)
            ChromeHelper.CopyPathToClipboard(_installation.ActivePath);
            ChromeHelper.OpenExtensionsPage();
            TxtFolder.Text = L10n.F("Wiz.Folder", _installation.ActivePath);
            ConfirmPanel.Visibility = Visibility.Collapsed;
            GuidePanel.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "install failed");
            MessageBox.Show(L10n.F("Wiz.InstallFailed", ex.Message), "ExtSync",
                MessageBoxButton.OK, MessageBoxImage.Error);
            BtnInstall.IsEnabled = true;
        }
    }

    private void OnOpenExtensions(object sender, RoutedEventArgs e) => ChromeHelper.OpenExtensionsPage();
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
