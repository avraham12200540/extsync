using System.Windows;
using ExtSync.Agent.Services;

namespace ExtSync.Agent.Views;

public partial class LinkInputWindow : Window
{
    public string? Token { get; private set; }

    public LinkInputWindow()
    {
        InitializeComponent();
        InputBox.Focus();
    }

    private void OnOk(object sender, RoutedEventArgs e)
    {
        Token = ExtractToken(InputBox.Text.Trim());
        if (string.IsNullOrEmpty(Token))
        {
            MessageBox.Show(L10n.T("Link.Invalid"), "ExtSync",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        DialogResult = true;
        Close();
    }

    private void OnCancel(object sender, RoutedEventArgs e) => Close();

    /// <summary>Accepts a raw token, an extsync:// URL, or an https .../install/{token} URL.</summary>
    public static string? ExtractToken(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var uri = CustomUri.Parse(input);
        if (uri?.Action == "install" && !string.IsNullOrEmpty(uri.Query["token"]))
            return uri.Query["token"];
        if (Uri.TryCreate(input, UriKind.Absolute, out var http) &&
            (http.Scheme == "http" || http.Scheme == "https"))
        {
            var segments = http.AbsolutePath.Trim('/').Split('/');
            var idx = Array.IndexOf(segments, "install");
            if (idx >= 0 && idx + 1 < segments.Length) return segments[idx + 1];
        }
        // Otherwise treat the whole input as the token.
        return input.Contains(' ') ? null : input;
    }
}
