using System.ComponentModel;
using System.Windows;

namespace ExtSync.Agent.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    // Closing hides to tray instead of exiting (the Agent keeps running, §18).
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
        base.OnClosing(e);
    }
}
