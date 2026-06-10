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

        var vm = new MainViewModel(_controller, _settings, _log);
        var window = new MainWindow { DataContext = vm };
        MainWindow = window;

        _tray = new TrayIcon(vm, window);

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
