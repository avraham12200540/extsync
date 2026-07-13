using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Media;
using ExtSync.Agent.Models;
using ExtSync.Agent.Mvvm;
using ExtSync.Agent.Services;
using ExtSync.Agent.Views;
using Serilog;

namespace ExtSync.Agent.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    private readonly AgentController _controller;
    private readonly AgentSettings _settings;
    private readonly ILogger _log;

    public ObservableCollection<ExtensionItemViewModel> Extensions { get; } = new();

    public MainViewModel(AgentController controller, AgentSettings settings, ILogger log)
    {
        _controller = controller;
        _settings = settings;
        _log = log;
        _controller.InstallationsChanged += () => Application.Current.Dispatcher.Invoke(Reload);
        L10n.LanguageChanged += () => Application.Current.Dispatcher.Invoke(Reload);

        CheckUpdatesCommand = new RelayCommand(_ => CheckUpdatesAsync());
        AddByLinkCommand = new RelayCommand(_ => AddByLinkAsync());
        OpenSettingsCommand = new RelayCommand(_ => OpenSettings());
        OpenStoreCommand = new RelayCommand(_ => OpenStore());
    }

    public const string StoreUrl = "https://extsync.com/store";

    public RelayCommand CheckUpdatesCommand { get; }
    public RelayCommand AddByLinkCommand { get; }
    public RelayCommand OpenSettingsCommand { get; }
    public RelayCommand OpenStoreCommand { get; }

    // Guards against a second extsync:// activation (arriving over the UI pipe)
    // opening a nested install/batch wizard while one is already running - both
    // entry points run only on the dispatcher thread, so a plain flag suffices.
    private bool _installFlowActive;

    private bool _busy;
    public bool IsBusy
    {
        get => _busy;
        set { SetField(ref _busy, value); OnPropertyChanged(nameof(BusyVisibility)); }
    }

    public Visibility BusyVisibility => IsBusy ? Visibility.Visible : Visibility.Collapsed;
    public Visibility EmptyVisibility => Extensions.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ListVisibility => Extensions.Count == 0 ? Visibility.Collapsed : Visibility.Visible;

    public Brush ConnectionColor => _controller.ServerConnected
        ? (Brush)Application.Current.Resources["Success"]
        : (Brush)Application.Current.Resources["Warning"];

    private string _connectionStatus = L10n.T("Conn.Connecting");
    public string ConnectionStatus { get => _connectionStatus; set => SetField(ref _connectionStatus, value); }

    private string _lastCheckText = L10n.T("Check.Never");
    public string LastCheckText { get => _lastCheckText; set => SetField(ref _lastCheckText, value); }

    public string ManagedCountText => L10n.F("Managed.Count", Extensions.Count);

    public async Task LoadAsync()
    {
        Reload();
        await Task.CompletedTask;
    }

    private void Reload()
    {
        Extensions.Clear();
        foreach (var inst in _controller.Installations)
            Extensions.Add(new ExtensionItemViewModel(inst, _controller, _log));
        ConnectionStatus = L10n.T(_controller.ServerConnected ? "Conn.Online" : "Conn.Offline");
        LastCheckText = _controller.LastCheck is { } t
            ? L10n.F("Check.Last", t.ToLocalTime().ToString("HH:mm")) : L10n.T("Check.Never");
        OnPropertyChanged(nameof(ManagedCountText));
        OnPropertyChanged(nameof(ConnectionColor));
        OnPropertyChanged(nameof(EmptyVisibility));
        OnPropertyChanged(nameof(ListVisibility));
    }

    private void OpenStore()
    {
        try { Process.Start(new ProcessStartInfo(StoreUrl) { UseShellExecute = true }); }
        catch (Exception ex) { _log.Warning(ex, "open store failed"); }
    }

    public async Task CheckUpdatesAsync()
    {
        try
        {
            IsBusy = true;
            await _controller.CheckUpdatesAsync(_settings.AutoUpdate);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "check updates failed");
            MessageBox.Show(L10n.T("Msg.CheckFailed"),
                "ExtSync", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { IsBusy = false; Reload(); }
    }

    private async Task AddByLinkAsync()
    {
        var dialog = new LinkInputWindow { Owner = Application.Current.MainWindow };
        if (dialog.ShowDialog() == true && !string.IsNullOrWhiteSpace(dialog.Token))
            await StartInstallWizardAsync(dialog.Token!);
    }

    public async Task StartInstallWizardAsync(string token)
    {
        if (_installFlowActive) { WindowHelpers.BringToFront(Application.Current.MainWindow); return; }
        _installFlowActive = true;
        try
        {
            var resolved = await _controller.ResolveAsync(token);
            var wizard = new InstallWizardWindow(token, resolved, _controller, _log)
            {
                Owner = Application.Current.MainWindow,
            };
            wizard.Loaded += (_, _) => WindowHelpers.BringToFront(wizard);
            wizard.ShowDialog();
            Reload();
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "resolve install link failed");
            MessageBox.Show(L10n.T("Msg.LinkInvalid"),
                "ExtSync", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { _installFlowActive = false; }
    }

    /// <summary>extsync://install-batch - install the user's whole site library,
    /// one guided wizard per extension, with per-item skip. Extensions already
    /// managed on this device are skipped automatically.</summary>
    public async Task StartBatchInstallAsync(string batchToken)
    {
        if (_installFlowActive) { WindowHelpers.BringToFront(Application.Current.MainWindow); return; }
        _installFlowActive = true;
        try
        {
            await RunBatchInstallAsync(batchToken);
        }
        finally { _installFlowActive = false; }
    }

    private async Task RunBatchInstallAsync(string batchToken)
    {
        List<ApiClient.BatchItem> items;
        IsBusy = true;
        try
        {
            items = await _controller.ResolveBatchAsync(batchToken);
        }
        catch (Exception ex)
        {
            IsBusy = false;
            _log.Warning(ex, "resolve install batch failed");
            MessageBox.Show(L10n.T("Batch.Invalid"),
                "ExtSync", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        IsBusy = false;

        var managed = _controller.Installations
            .Where(i => i.Status != InstallationStatus.Removed)
            .Select(i => i.ProjectId)
            .ToHashSet();
        var pending = items.Where(i => !managed.Contains(i.ProjectId)).ToList();
        var already = items.Count - pending.Count;
        if (pending.Count == 0)
        {
            MessageBox.Show(L10n.T("Batch.AllInstalled"), L10n.T("Batch.SummaryTitle"),
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        int installed = 0, skipped = 0;
        for (var i = 0; i < pending.Count; i++)
        {
            var item = pending[i];
            try
            {
                var resolved = await _controller.ResolveAsync(item.Token);
                var wizard = new InstallWizardWindow(item.Token, resolved, _controller, _log,
                    batchPosition: i + 1, batchTotal: pending.Count)
                {
                    Owner = Application.Current.MainWindow,
                };
                wizard.Loaded += (_, _) => WindowHelpers.BringToFront(wizard);
                wizard.ShowDialog();
                Reload();
                if (wizard.Outcome == InstallWizardWindow.WizardOutcome.Skipped)
                    skipped++;
                else if (wizard.Outcome is InstallWizardWindow.WizardOutcome.Installed
                         or InstallWizardWindow.WizardOutcome.Loaded)
                    installed++;
                else
                    break; // wizard closed without installing - stop the queue
            }
            catch (Exception ex)
            {
                // A single unavailable extension must not kill the whole queue.
                _log.Warning(ex, "batch item {Project} failed to resolve - skipping", item.ProjectId);
                skipped++;
            }
        }
        MessageBox.Show(L10n.F("Batch.Summary", installed, skipped, already),
            L10n.T("Batch.SummaryTitle"), MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OpenSettings()
    {
        new SettingsWindow(_settings) { Owner = Application.Current.MainWindow }.ShowDialog();
    }
}
