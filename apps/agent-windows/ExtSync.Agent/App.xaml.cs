using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Windows;
using ExtSync.Agent.Crypto;
using ExtSync.Agent.Services;
using ExtSync.Agent.ViewModels;
using ExtSync.Agent.Views;
using Serilog;

namespace ExtSync.Agent;

public partial class App : Application
{
    private const string SingleInstanceMutex = "ExtSyncAgent.SingleInstance";
    private const string UiPipeName = "extsync-agent-ui";

    private Mutex? _mutex;
    private AgentController? _controller;
    private AgentSettings _settings = null!;
    private ILogger _log = null!;
    private TrayIcon? _tray;
    private AgentWebSocket? _ws;
    private SelfUpdateService? _selfUpdate;
    private CancellationTokenSource _cts = new();

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _mutex = new Mutex(true, SingleInstanceMutex, out bool isNew);
        var uriArg = CustomUri.FromArgs(e.Args);
        if (!isNew)
        {
            // Another instance owns the UI. Forward any extsync:// URL and exit.
            if (uriArg != null) ForwardToRunningInstance(uriArg);
            else ForwardToRunningInstance("show");
            Shutdown();
            return;
        }

        AgentPaths.EnsureCreated();
        _log = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .WriteTo.File(Path.Combine(AgentPaths.LogsDir, "agent-.log"),
                rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14,
                outputTemplate: "{Timestamp:o} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
        Log.Logger = _log;

        _settings = AgentSettings.Load();
        _settings.AgentVersion = GetType().Assembly.GetName().Version?.ToString(3) ?? "1.0.0";

        // Compose services.
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        var api = new ApiClient(_settings, http);
        var store = new LocalStore();
        var pipe = new PipeServer(_log);
        var verifier = ReleaseVerifier.FromBase64Map(LoadPublicKeys());
        var updates = new UpdateService(api, verifier, pipe, store, _settings, http, _log);
        var hostExe = Path.Combine(AgentPaths.NativeHostDir, "extsync-native-host.exe");
        var nmh = new NativeMessagingRegistrar(_log, hostExe);
        _controller = new AgentController(_settings, store, api, updates, pipe, nmh, _log);
        _selfUpdate = new SelfUpdateService(_settings, verifier, _log,
            (title, msg) => _tray?.ShowNotification(title, msg));

        var vm = new MainViewModel(_controller, _settings, _log);
        var window = new MainWindow { DataContext = vm };
        MainWindow = window;

        _tray = new TrayIcon(vm, window);

        // First run after a self-update: confirm quietly via a tray balloon.
        if (_settings.LastRunVersion != _settings.AgentVersion)
        {
            if (!string.IsNullOrEmpty(_settings.LastRunVersion))
                _tray.ShowNotification("ExtSync Agent", $"עודכן לגרסה {_settings.AgentVersion} בהצלחה ✓");
            _settings.LastRunVersion = _settings.AgentVersion;
            _settings.Save();
        }

        StartUiPipeListener();

        await _controller.InitializeAsync(_cts.Token);
        await vm.LoadAsync();

        if (uriArg != null) await HandleUri(uriArg, vm);
        else window.Show();

        // Real-time push via WebSocket (with the poller below as fallback, §6).
        _ws = new AgentWebSocket(_settings, () => Dispatcher.InvokeAsync(vm.CheckUpdatesAsync).Task.Unwrap(), _log);
        _ws.Start();

        // Background update scheduler (polling fallback, §6).
        _ = RunSchedulerAsync(vm);

        // Agent self-update: shortly after launch, then every 6 hours (§28).
        _ = RunSelfUpdateLoopAsync();

        // Catch up immediately on launch — don't wait for the first poll interval
        // (covers versions published while the Agent was closed).
        if (_settings.AutoCheck) _ = vm.CheckUpdatesAsync();
    }

    private async Task RunSelfUpdateLoopAsync()
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), _cts.Token); }
        catch (OperationCanceledException) { return; }
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                if (_selfUpdate != null && await _selfUpdate.CheckAndApplyAsync(_cts.Token))
                    return; // shutting down to apply the update
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { _log.Warning(ex, "self-update check failed"); }
            try { await Task.Delay(TimeSpan.FromHours(6), _cts.Token); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task RunSchedulerAsync(MainViewModel vm)
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(_settings.CheckInterval, _cts.Token);
                if (_settings.AutoCheck) await vm.CheckUpdatesAsync();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { _log.Warning(ex, "scheduler iteration failed"); }
        }
    }

    private void StartUiPipeListener()
    {
        _ = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(UiPipeName, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                    await server.WaitForConnectionAsync(_cts.Token);
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var msg = await reader.ReadLineAsync(_cts.Token);
                    if (msg != null)
                        await Dispatcher.InvokeAsync(async () =>
                        {
                            var vm = (MainViewModel)MainWindow!.DataContext;
                            if (msg.StartsWith("extsync://")) await HandleUri(msg, vm);
                            else { MainWindow.Show(); MainWindow.Activate(); }
                        });
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { _log.Warning(ex, "ui pipe listener error"); }
            }
        });
    }

    private static void ForwardToRunningInstance(string message)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", UiPipeName, PipeDirection.Out);
            client.Connect(2000);
            using var writer = new StreamWriter(client, Encoding.UTF8) { AutoFlush = true };
            writer.WriteLine(message);
        }
        catch { /* running instance may be busy; ignore */ }
    }

    private async Task HandleUri(string raw, MainViewModel vm)
    {
        var parsed = CustomUri.Parse(raw);
        if (parsed?.Action == "install")
        {
            var token = parsed.Query["token"];
            if (!string.IsNullOrEmpty(token))
            {
                MainWindow!.Show();
                MainWindow.Activate();
                await vm.StartInstallWizardAsync(token);
                return;
            }
        }
        MainWindow!.Show();
        MainWindow.Activate();
    }

    /// <summary>Platform public keys are baked into the build (§26). In dev they are
    /// read from EXTSYNC_PUBLIC_KEYS or a bundled keys.json next to the exe.</summary>
    private Dictionary<string, string> LoadPublicKeys()
    {
        var fromEnv = Environment.GetEnvironmentVariable("EXTSYNC_PUBLIC_KEYS");
        var raw = fromEnv;
        var keysFile = Path.Combine(AppContext.BaseDirectory, "keys.json");
        if (string.IsNullOrEmpty(raw) && File.Exists(keysFile))
        {
            try
            {
                var map = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(
                    File.ReadAllText(keysFile));
                if (map != null) return map;
            }
            catch { /* fall through */ }
        }
        var result = new Dictionary<string, string>();
        foreach (var entry in (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = entry.IndexOf(':');
            if (idx > 0) result[entry[..idx].Trim()] = entry[(idx + 1)..].Trim();
        }
        return result;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _cts.Cancel();
        _tray?.Dispose();
        if (_ws != null) { _ = _ws.DisposeAsync(); }
        _mutex?.Dispose();
        Log.CloseAndFlush();
        base.OnExit(e);
    }
}
