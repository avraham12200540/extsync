using System.Windows;

namespace ExtSync.Agent.Services;

/// <summary>Window foregrounding helpers.</summary>
public static class WindowHelpers
{
    /// <summary>Bring a window to the front of the screen, even when the trigger came
    /// from the background - e.g. an extsync:// activation forwarded over the pipe to
    /// the already-running instance. Windows blocks a background app from stealing
    /// focus, so Activate() alone often only flashes the taskbar; toggling Topmost
    /// forces the window to the top of the z-order regardless of the focus rules.</summary>
    public static void BringToFront(Window? w)
    {
        if (w is null) return;
        if (w.WindowState == WindowState.Minimized) w.WindowState = WindowState.Normal;
        if (!w.IsVisible) w.Show();
        w.Activate();
        w.Topmost = true;
        w.Topmost = false;
        w.Focus();
    }
}
