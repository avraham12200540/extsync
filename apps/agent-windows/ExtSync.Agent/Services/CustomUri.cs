using System.Collections.Specialized;
using System.Web;

namespace ExtSync.Agent.Services;

/// <summary>Parses extsync:// activation URLs (§16). Example:
/// <c>extsync://install?token=abc</c>.</summary>
public static class CustomUri
{
    public const string Scheme = "extsync";

    public sealed record ParsedUri(string Action, NameValueCollection Query);

    public static ParsedUri? Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return null;
        if (!string.Equals(uri.Scheme, Scheme, StringComparison.OrdinalIgnoreCase)) return null;
        // For extsync://install?token=..., Host = "install".
        var action = string.IsNullOrEmpty(uri.Host) ? uri.AbsolutePath.Trim('/') : uri.Host;
        var query = HttpUtility.ParseQueryString(uri.Query);
        return new ParsedUri(action.ToLowerInvariant(), query);
    }

    /// <summary>Find an extsync:// argument among the process command-line args.</summary>
    public static string? FromArgs(string[] args) =>
        args.FirstOrDefault(a => a.StartsWith(Scheme + "://", StringComparison.OrdinalIgnoreCase));
}
