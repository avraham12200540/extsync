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
        TxtDeveloper.Text = $"מאת {Str("developerName")}";
        var version = Str("version");
        var channel = Str("channel");
        TxtMeta.Text = $"גרסה {(string.IsNullOrEmpty(version) ? "—" : version)} • ערוץ {channel}";
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
            TxtHosts.Text = string.IsNullOrEmpty(joined) ? "" : $"אתרים שאליהם התוסף ניגש: {joined}";
        }

        var usable = !_resolved.TryGetProperty("usable", out var u) || u.GetBoolean();
        if (!usable)
        {
            BtnInstall.IsEnabled = false;
            TxtDescription.Text = "קישור ההתקנה אינו זמין יותר (פג תוקף או נוצל).";
        }
    }

    private async void OnInstall(object sender, RoutedEventArgs e)
    {
        BtnInstall.IsEnabled = false;
        try
        {
            _installation = await _controller.InstallFromTokenAsync(_token, _resolved);
            // Prepare the guided manual load.
            ChromeHelper.CopyPathToClipboard(_installation.ActivePath);
            ChromeHelper.OpenExtensionsPage();
            ChromeHelper.OpenFolder(_installation.ActivePath);
            TxtFolder.Text = $"נתיב התיקייה: {_installation.ActivePath}";
            ConfirmPanel.Visibility = Visibility.Collapsed;
            GuidePanel.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "install failed");
            MessageBox.Show("ההתקנה נכשלה: " + ex.Message, "ExtSync",
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
        TxtGuideStatus.Text = "הכתובת chrome://extensions הועתקה — הדבק בשורת הכתובת של Chrome. " +
                              "לפני 'טען פריט לא ארוז' לחץ שוב 'העתק נתיב התיקייה'.";
    }

    private void OnConfirmLoaded(object sender, RoutedEventArgs e)
    {
        if (_installation == null) return;
        _controller.MarkManuallyLoaded(_installation.ProjectId);
        TxtGuideStatus.Text = "מצוין! התוסף סומן כמותקן ועדכונים עתידיים ינוהלו אוטומטית. אפשר לסגור.";
        BtnConfirmLoaded.IsEnabled = false;
    }

    private void OnHelp(object sender, RoutedEventArgs e)
    {
        MessageBox.Show(
            "אם התוסף לא נטען:\n" +
            "• ודא ש'מצב מפתח' מופעל בדף chrome://extensions.\n" +
            "• ודא שבחרת את התיקייה הנכונה (זו שפתחנו ב-Explorer).\n" +
            "• נסה ללחוץ 'פתח שוב את דף התוספים' ואז 'טען פריט לא ארוז'.",
            "עזרה", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OnCancel(object sender, RoutedEventArgs e) => Close();
}
