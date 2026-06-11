using System.Windows;
using System.Windows.Media;
using ExtSync.Agent.Models;
using ExtSync.Agent.Mvvm;
using ExtSync.Agent.Services;
using Serilog;

namespace ExtSync.Agent.ViewModels;

public sealed class ExtensionItemViewModel : ObservableObject
{
    private readonly LocalInstallation _inst;
    private readonly AgentController _controller;
    private readonly ILogger _log;

    public ExtensionItemViewModel(LocalInstallation inst, AgentController controller, ILogger log)
    {
        _inst = inst; _controller = controller; _log = log;
        CheckCommand = new RelayCommand(async _ =>
        {
            try { await _controller.CheckUpdatesAsync(false); }
            catch (Exception ex) { _log.Warning(ex, "per-item check failed"); }
        });
        PauseCommand = new RelayCommand(_ => { _controller.SetPaused(_inst.ProjectId, !_inst.UpdatesPaused); return Task.CompletedTask; });
        OpenFolderCommand = new RelayCommand(_ => { ChromeHelper.OpenFolder(_inst.ActivePath); return Task.CompletedTask; });
        OpenExtensionsCommand = new RelayCommand(_ => { ChromeHelper.OpenExtensionsPage(); return Task.CompletedTask; });
        RollbackCommand = new RelayCommand(_ => RollbackAsync());
        RemoveCommand = new RelayCommand(_ => RemoveAsync());
    }

    public string Name => string.IsNullOrEmpty(_inst.Name) ? _inst.ProjectId : _inst.Name;
    public string DeveloperName => _inst.DeveloperName;
    public string Version => string.IsNullOrEmpty(_inst.CurrentVersion) ? "-" : $"v{_inst.CurrentVersion}";
    public string Channel => _inst.Channel;
    public string ExtensionId => _inst.ExtensionId;
    public bool UpdatesPaused => _inst.UpdatesPaused;
    public string PauseText => L10n.T(_inst.UpdatesPaused ? "Pause.Resume" : "Pause.Do");
    public string LastUpdatedText => _inst.LastUpdatedAt is { } t ? t.ToLocalTime().ToString("dd/MM HH:mm") : "-";

    public string StatusText => _inst.Status switch
    {
        InstallationStatus.UpToDate => L10n.T("St.UpToDate"),
        InstallationStatus.UpdateAvailable => L10n.T("St.UpdateAvailable"),
        InstallationStatus.Updating => L10n.T("St.Updating"),
        InstallationStatus.Downloading => L10n.T("St.Downloading"),
        InstallationStatus.AwaitingManualLoad => L10n.T("St.AwaitManual"),
        InstallationStatus.ReloadRequired => L10n.T("St.ReloadRequired"),
        InstallationStatus.Paused => L10n.T("St.Paused"),
        InstallationStatus.Broken => L10n.T("St.Broken"),
        InstallationStatus.RollbackInProgress => L10n.T("St.RollingBack"),
        _ => _inst.Status.ToString(),
    };

    public Brush StatusColor => _inst.Status switch
    {
        InstallationStatus.UpToDate => (Brush)Application.Current.Resources["Success"],
        InstallationStatus.UpdateAvailable => (Brush)Application.Current.Resources["Brand"],
        InstallationStatus.ReloadRequired or InstallationStatus.AwaitingManualLoad
            => (Brush)Application.Current.Resources["Warning"],
        InstallationStatus.Broken => (Brush)Application.Current.Resources["Danger"],
        _ => (Brush)Application.Current.Resources["TextMuted"],
    };

    public bool BridgeConnected => _inst.BridgeConnected;
    public string BridgeText => _inst.HasBridge
        ? L10n.T(_inst.BridgeConnected ? "Bridge.On" : "Bridge.Off")
        : L10n.T("Bridge.None");

    public RelayCommand CheckCommand { get; }
    public RelayCommand PauseCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand OpenExtensionsCommand { get; }
    public RelayCommand RollbackCommand { get; }
    public RelayCommand RemoveCommand { get; }

    private async Task RollbackAsync()
    {
        var ok = MessageBox.Show(
            L10n.F("Dlg.Rollback.Body", Name),
            L10n.T("Dlg.Rollback.Title"), MessageBoxButton.OKCancel, MessageBoxImage.Question);
        if (ok != MessageBoxResult.OK) return;
        var success = await _controller.RollbackAsync(_inst.ProjectId);
        if (!success)
            MessageBox.Show(L10n.T("Dlg.Rollback.Failed"), "ExtSync",
                MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private async Task RemoveAsync()
    {
        // One dialog instead of two: Yes = remove + delete files, No = remove only.
        var result = MessageBox.Show(
            L10n.F("Dlg.Remove.Body", Name),
            L10n.T("Dlg.Remove.Title"), MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (result == MessageBoxResult.Cancel || result == MessageBoxResult.None) return;

        await _controller.RemoveAsync(_inst.ProjectId, deleteFiles: result == MessageBoxResult.Yes);
    }
}
