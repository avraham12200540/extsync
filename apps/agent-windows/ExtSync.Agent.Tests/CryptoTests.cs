using System.Text;
using System.Text.Json;
using ExtSync.Agent.Crypto;
using ExtSync.Agent.Services;
using ExtSync.Agent.Views;
using Xunit;

namespace ExtSync.Agent.Tests;

/// <summary>
/// Proves the .NET canonicalizer + Ed25519 verifier agree byte-for-byte with the
/// Python/TS reference (POC: signature interop). Run with `dotnet test`.
/// </summary>
public class CryptoTests
{
    private static JsonElement LoadVectors()
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "vectors.json"));
        return JsonDocument.Parse(json).RootElement;
    }

    [Fact]
    public void Canonicalize_MatchesReferenceVectors()
    {
        var v = LoadVectors();
        foreach (var c in v.GetProperty("canonicalCases").EnumerateArray())
        {
            var input = c.GetProperty("input");
            var expected = c.GetProperty("canonical").GetString();
            Assert.Equal(expected, CanonicalJson.Canonicalize(input));
        }
    }

    [Fact]
    public void SampleCanonical_MatchesReference()
    {
        var v = LoadVectors();
        var meta = v.GetProperty("sampleMetadata");
        var expected = v.GetProperty("sampleCanonical").GetString()!;
        var bytes = CanonicalJson.CanonicalBytesExcluding(meta, "signature");
        Assert.Equal(expected, Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public void VerifyMetadata_AcceptsValidSignature_AndRejectsTamper()
    {
        var v = LoadVectors();
        var signed = v.GetProperty("sampleSigned");
        var keyId = v.GetProperty("keyId").GetString()!;
        var pub = v.GetProperty("publicKeyB64").GetString()!;

        var verifier = ReleaseVerifier.FromBase64Map(new Dictionary<string, string> { [keyId] = pub });
        Assert.True(verifier.VerifyMetadata(signed));

        // Tamper: change a field and re-serialize.
        var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signed.GetRawText())!;
        dict["version"] = JsonSerializer.SerializeToElement("9.9.9");
        var tampered = JsonSerializer.SerializeToElement(dict);
        Assert.False(verifier.VerifyMetadata(tampered));

        // Unknown keyId.
        var other = ReleaseVerifier.FromBase64Map(new Dictionary<string, string> { ["nope"] = pub });
        Assert.False(other.VerifyMetadata(signed));
    }

    [Fact]
    public void VersionCompare_Works()
    {
        Assert.True(VersionUtil.Gte("1.2.0", "1.1.9"));
        Assert.True(VersionUtil.Gte("2.0", "1.9.9"));
        Assert.False(VersionUtil.Gte("1.0.0", "1.0.1"));
        Assert.True(VersionUtil.Gte("1.0.0", "1.0.0"));
    }

    [Fact]
    public void ExtractToken_ParsesAllForms()
    {
        Assert.Equal("abc", LinkInputWindow.ExtractToken("extsync://install?token=abc"));
        Assert.Equal("abc", LinkInputWindow.ExtractToken("https://extsync.local/install/abc"));
        Assert.Equal("abc", LinkInputWindow.ExtractToken("abc"));
    }
}
