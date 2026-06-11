using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using ExtSync.Agent.Services;
using ExtSync.Agent.ViewModels;
using Hardcodet.Wpf.TaskbarNotification;

namespace ExtSync.Agent.Views;

/// <summary>System tray icon + menu (§18 Tray Menu).</summary>
public sealed class TrayIcon : IDisposable
{
    private readonly TaskbarIcon _icon;
    private readonly MainViewModel _vm;
    private readonly Window _window;
    private readonly Action _onLanguageChanged;

    public TrayIcon(MainViewModel vm, Window window)
    {
        _vm = vm;
        _window = window;
        _icon = new TaskbarIcon
        {
            ToolTipText = "ExtSync Agent",
            Visibility = Visibility.Visible,
            // Without an explicit icon the tray entry is invisible and the app
            // becomes unreachable after the window is closed to tray.
            IconSource = BitmapFrame.Create(
                new Uri("pack://application:,,,/Assets/extsync.ico", UriKind.Absolute)),
        };
        _icon.TrayMouseDoubleClick += (_, _) => ShowWindow();
        _icon.ContextMenu = BuildMenu();
        _onLanguageChanged = () => _icon.ContextMenu = BuildMenu();
        L10n.LanguageChanged += _onLanguageChanged;
    }

    private ContextMenu BuildMenu()
    {
        var menu = new ContextMenu { FlowDirection = L10n.Flow };
        menu.Items.Add(MenuItem(L10n.T("Tray.Open"), (_, _) => ShowWindow()));
        menu.Items.Add(MenuItem(L10n.T("Tray.Check"), async (_, _) => await _vm.CheckUpdatesAsync()));
        menu.Items.Add(MenuItem(L10n.T("Tray.Store"), (_, _) => _vm.OpenStoreCommand.Execute(null)));
        menu.Items.Add(new Separator());
        menu.Items.Add(MenuItem(L10n.T("Tray.Exit"), (_, _) => Application.Current.Shutdown()));
        return menu;
    }

    private static MenuItem MenuItem(string header, RoutedEventHandler onClick)
    {
        var item = new MenuItem { Header = header };
        item.Click += onClick;
        return item;
    }

    private void ShowWindow()
    {
        _window.Show();
        _window.WindowState = WindowState.Normal;
        _window.Activate();
    }

    public void ShowNotification(string title, string message) =>
        _icon.ShowBalloonTip(title, message, BalloonIcon.Info);

    public void Dispose()
    {
        L10n.LanguageChanged -= _onLanguageChanged;
        _icon.Dispose();
    }
}
