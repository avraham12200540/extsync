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
        ChkStartup.IsChecked = settings.StartWithWindows;
        ChkAutoCheck.IsChecked = settings.AutoCheck;
        TxtInterval.Text = settings.CheckIntervalHours.ToString();
        ChkAutoUpdate.IsChecked = settings.AutoUpdate;
        ChkBackground.IsChecked = settings.DownloadInBackground;
        ChkNotify.IsChecked = settings.WindowsNotifications;
        TxtRollback.Text = settings.RollbackVersionsToKeep.ToString();
        ChkBeta.IsChecked = settings.UseAgentBeta;
        ChkTelemetry.IsChecked = settings.OptInTelemetry;
    }

    private void OnSave(object sender, RoutedEventArgs e)
    {
        _settings.StartWithWindows = ChkStartup.IsChecked == true;
        _settings.AutoCheck = ChkAutoCheck.IsChecked == true;
        if (int.TryParse(TxtInterval.Text, out var h)) _settings.CheckIntervalHours = Math.Clamp(h, 1, 168);
        _settings.AutoUpdate = ChkAutoUpdate.IsChecked == true;
        _settings.DownloadInBackground = ChkBackground.IsChecked == true;
        _settings.WindowsNotifications = ChkNotify.IsChecked == true;
        if (int.TryParse(TxtRollback.Text, out var r)) _settings.RollbackVersionsToKeep = Math.Clamp(r, 1, 10);
        _settings.UseAgentBeta = ChkBeta.IsChecked == true;
        _settings.OptInTelemetry = ChkTelemetry.IsChecked == true;
        _settings.Save();
        StartupRegistration.Apply(_settings.StartWithWindows);
        MessageBox.Show("ההגדרות נשמרו.", "ExtSync", MessageBoxButton.OK, MessageBoxImage.Information);
        Close();
    }

    private void OnExportLogs(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{AgentPaths.LogsDir}\"") { UseShellExecute = true });
    }

    private void OnClose(object sender, RoutedEventArgs e) => Close();
}
