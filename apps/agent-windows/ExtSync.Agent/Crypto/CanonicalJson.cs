using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ExtSync.Agent.Crypto;

/// <summary>
/// Canonical JSON producing byte-identical output to the TypeScript and Python
/// implementations in packages/release-schema. Rules (RFC 8785 subset):
///  - object keys sorted by ordinal (ASCII) order
///  - no insignificant whitespace
///  - minimal string escaping, non-ASCII left as-is, UTF-8 output
///  - integers in shortest form (no float in signed metadata)
/// Verified against packages/release-schema/schema/vectors.json.
/// </summary>
public static class CanonicalJson
{
    /// <summary>Canonical bytes of <paramref name="root"/> with the given top-level
    /// field removed (used to exclude "signature" before verifying).</summary>
    public static byte[] CanonicalBytesExcluding(JsonElement root, string excludeKey)
    {
        var sb = new StringBuilder();
        WriteCanonical(root, sb, excludeKey);
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    public static string Canonicalize(JsonElement element)
    {
        var sb = new StringBuilder();
        WriteCanonical(element, sb, null);
        return sb.ToString();
    }

    private static void WriteCanonical(JsonElement element, StringBuilder sb, string? excludeKeyAtTop)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                sb.Append('{');
                var props = new List<JsonProperty>();
                foreach (var p in element.EnumerateObject())
                {
                    if (excludeKeyAtTop != null && p.Name == excludeKeyAtTop) continue;
                    props.Add(p);
                }
                props.Sort(static (a, b) => string.CompareOrdinal(a.Name, b.Name));
                for (int i = 0; i < props.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    WriteString(props[i].Name, sb);
                    sb.Append(':');
                    WriteCanonical(props[i].Value, sb, null); // exclude only applies at top level
                }
                sb.Append('}');
                break;

            case JsonValueKind.Array:
                sb.Append('[');
                bool first = true;
                foreach (var item in element.EnumerateArray())
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteCanonical(item, sb, null);
                }
                sb.Append(']');
                break;

            case JsonValueKind.String:
                WriteString(element.GetString() ?? string.Empty, sb);
                break;

            case JsonValueKind.Number:
                // Signed metadata uses integers only; emit shortest form.
                if (element.TryGetInt64(out var l))
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                else
                    throw new InvalidOperationException("Non-integer number in signed metadata");
                break;

            case JsonValueKind.True:
                sb.Append("true");
                break;
            case JsonValueKind.False:
                sb.Append("false");
                break;
            case JsonValueKind.Null:
                throw new InvalidOperationException("null not allowed in signed metadata");
            default:
                throw new InvalidOperationException($"Unsupported JSON kind {element.ValueKind}");
        }
    }

    private static void WriteString(string s, StringBuilder sb)
    {
        sb.Append('"');
        foreach (var ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20)
                        sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    else
                        sb.Append(ch);
                    break;
            }
        }
        sb.Append('"');
    }
}
