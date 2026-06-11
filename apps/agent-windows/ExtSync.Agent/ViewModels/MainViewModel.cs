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
        try
        {
            var resolved = await _controller.ResolveAsync(token);
            var wizard = new InstallWizardWindow(token, resolved, _controller, _log)
            {
                Owner = Application.Current.MainWindow,
            };
            wizard.ShowDialog();
            Reload();
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "resolve install link failed");
            MessageBox.Show(L10n.T("Msg.LinkInvalid"),
                "ExtSync", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OpenSettings()
    {
        new SettingsWindow(_settings) { Owner = Application.Current.MainWindow }.ShowDialog();
    }
}
