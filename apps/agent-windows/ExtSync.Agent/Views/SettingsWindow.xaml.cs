using System.Diagnostics;
using System.Windows;
using ExtSync.Agent.Services;

namespace ExtSync.Agent.Views;

public partial class SettingsWindow : Window
{
    private readonly AgentSettings _settings;

    public SettingsWindow(AgentSettings settings)
    {
        InitializeComponent();
        _settings = settings;
        CmbLanguage.SelectedIndex = settings.Language == "en" ? 1 : 0;
        ChkStartup.IsChecked = settings.StartWithWindows;
        ChkAutoCheck.IsChecked = settings.AutoCheck;
        TxtInterval.Text = settings.CheckIntervalValue.ToString();
        CmbIntervalUnit.SelectedIndex = settings.CheckIntervalUnit switch
        {
            "seconds" => 0, "minutes" => 1, "days" => 3, _ => 2,
        };
        ChkAutoUpdate.IsChecked = settings.AutoUpdate;
        ChkBackground.IsChecked = settings.DownloadInBackground;
        ChkNotify.IsChecked = settings.WindowsNotifications;
        TxtRollback.Text = settings.RollbackVersionsToKeep.ToString();
        ChkBeta.IsChecked = settings.UseAgentBeta;
        ChkTelemetry.IsChecked = settings.OptInTelemetry;
        TxtVersion.Text = L10n.F("Set.Version", settings.AgentVersion);
    }

    private void OnSave(object sender, RoutedEventArgs e)
    {
        var newLang = CmbLanguage.SelectedIndex == 1 ? "en" : "he";
        if (newLang != _settings.Language)
        {
            _settings.Language = newLang;
            L10n.Apply(newLang); // live-updates every open window (DynamicResource)
            TxtVersion.Text = L10n.F("Set.Version", _settings.AgentVersion);
        }
        _settings.StartWithWindows = ChkStartup.IsChecked == true;
        _settings.AutoCheck = ChkAutoCheck.IsChecked == true;
        if (int.TryParse(TxtInterval.Text, out var v)) _settings.CheckIntervalValue = Math.Clamp(v, 1, 100000);
        _settings.CheckIntervalUnit = CmbIntervalUnit.SelectedIndex switch
        {
            0 => "seconds", 1 => "minutes", 3 => "days", _ => "hours",
        };
        _settings.AutoUpdate = ChkAutoUpdate.IsChecked == true;
        _settings.DownloadInBackground = ChkBackground.IsChecked == true;
        _settings.WindowsNotifications = ChkNotify.IsChecked == true;
        if (int.TryParse(TxtRollback.Text, out var r)) _settings.RollbackVersionsToKeep = Math.Clamp(r, 1, 10);
        _settings.UseAgentBeta = ChkBeta.IsChecked == true;
        _settings.OptInTelemetry = ChkTelemetry.IsChecked == true;
        _settings.Save();
        StartupRegistration.Apply(_settings.StartWithWindows);
        MessageBox.Show(L10n.T("Set.Saved"), "ExtSync", MessageBoxButton.OK, MessageBoxImage.Information);
        Close();
    }

    private void OnExportLogs(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{AgentPaths.LogsDir}\"") { UseShellExecute = true });
    }

    private void OnClose(object sender, RoutedEventArgs e) => Close();
}
