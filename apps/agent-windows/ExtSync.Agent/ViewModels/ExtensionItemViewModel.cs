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
        CheckCommand = new RelayCommand(_ => _controller.CheckUpdatesAsync(false));
        PauseCommand = new RelayCommand(_ => { _controller.SetPaused(_inst.ProjectId, !_inst.UpdatesPaused); return Task.CompletedTask; });
        OpenFolderCommand = new RelayCommand(_ => { ChromeHelper.OpenFolder(_inst.ActivePath); return Task.CompletedTask; });
        OpenExtensionsCommand = new RelayCommand(_ => { ChromeHelper.OpenExtensionsPage(); return Task.CompletedTask; });
        RollbackCommand = new RelayCommand(_ => RollbackAsync());
        RemoveCommand = new RelayCommand(_ => RemoveAsync());
    }

    public string Name => string.IsNullOrEmpty(_inst.Name) ? _inst.ProjectId : _inst.Name;
    public string DeveloperName => _inst.DeveloperName;
    public string Version => string.IsNullOrEmpty(_inst.CurrentVersion) ? "—" : $"v{_inst.CurrentVersion}";
    public string Channel => _inst.Channel;
    public string ExtensionId => _inst.ExtensionId;
    public bool UpdatesPaused => _inst.UpdatesPaused;
    public string LastUpdatedText => _inst.LastUpdatedAt is { } t ? t.ToLocalTime().ToString("dd/MM HH:mm") : "—";

    public string StatusText => _inst.Status switch
    {
        InstallationStatus.UpToDate => "מעודכן",
        InstallationStatus.UpdateAvailable => "עדכון זמין",
        InstallationStatus.Updating => "מעדכן…",
        InstallationStatus.Downloading => "מוריד…",
        InstallationStatus.AwaitingManualLoad => "ממתין לטעינה ב-Chrome",
        InstallationStatus.ReloadRequired => "נדרשת טעינה מחדש",
        InstallationStatus.Paused => "מושהה",
        InstallationStatus.Broken => "תקלה",
        InstallationStatus.RollbackInProgress => "מבצע Rollback…",
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
        ? (_inst.BridgeConnected ? "Bridge מחובר" : "Bridge לא מחובר")
        : "ללא Bridge";

    public RelayCommand CheckCommand { get; }
    public RelayCommand PauseCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand OpenExtensionsCommand { get; }
    public RelayCommand RollbackCommand { get; }
    public RelayCommand RemoveCommand { get; }

    private async Task RollbackAsync()
    {
        var ok = MessageBox.Show(
            $"לחזור לגרסה הקודמת של {Name}? הגרסה הנוכחית תישמר בתיקיית failed.",
            "Rollback", MessageBoxButton.OKCancel, MessageBoxImage.Question);
        if (ok != MessageBoxResult.OK) return;
        var success = await _controller.RollbackAsync(_inst.ProjectId);
        if (!success)
            MessageBox.Show("ה-Rollback נכשל. הגרסה הנוכחית נשארה.", "ExtSync",
                MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private async Task RemoveAsync()
    {
        var result = MessageBox.Show(
            $"להפסיק לנהל את {Name}?\n\nלחיצה על 'כן' תפסיק את הניהול אך תשאיר את קבצי התוסף.\n" +
            "כדי למחוק גם את הקבצים, נשמח שתאשר בנפרד לאחר מכן.",
            "הסרה", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result != MessageBoxResult.Yes) return;

        var deleteFiles = MessageBox.Show(
            "למחוק גם את קבצי התוסף מהמחשב? (התוסף לא יוסר אוטומטית מ-Chrome)",
            "מחיקת קבצים", MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes;

        await _controller.RemoveAsync(_inst.ProjectId, deleteFiles);
    }
}
