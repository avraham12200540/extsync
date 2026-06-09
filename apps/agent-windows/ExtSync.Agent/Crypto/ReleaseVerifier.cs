using System.Security.Cryptography;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace ExtSync.Agent.Crypto;

/// <summary>
/// Verifies the platform's Ed25519 signature over release metadata and the
/// SHA-256 of the downloaded artifact (ADR-0003). The Agent ships the platform
/// public key(s); it refuses to install anything that fails verification.
/// </summary>
public sealed class ReleaseVerifier
{
    private readonly IReadOnlyDictionary<string, byte[]> _publicKeys;

    /// <param name="publicKeys">map keyId -> 32-byte Ed25519 public key (decoded from base64).</param>
    public ReleaseVerifier(IReadOnlyDictionary<string, byte[]> publicKeys)
    {
        _publicKeys = publicKeys;
    }

    public static ReleaseVerifier FromBase64Map(IReadOnlyDictionary<string, string> b64)
    {
        var decoded = new Dictionary<string, byte[]>();
        foreach (var (k, v) in b64) decoded[k] = Convert.FromBase64String(v);
        return new ReleaseVerifier(decoded);
    }

    /// <summary>True only if keyId is known and the Ed25519 signature is valid.</summary>
    public bool VerifyMetadata(JsonElement metadata)
    {
        if (!metadata.TryGetProperty("keyId", out var keyIdEl)) return false;
        if (!metadata.TryGetProperty("signature", out var sigEl)) return false;
        var keyId = keyIdEl.GetString();
        var sigB64 = sigEl.GetString();
        if (keyId is null || sigB64 is null) return false;
        if (!_publicKeys.TryGetValue(keyId, out var pub)) return false;

        byte[] signature;
        try { signature = Convert.FromBase64String(sigB64); }
        catch (FormatException) { return false; }

        var message = CanonicalJson.CanonicalBytesExcluding(metadata, "signature");

        var verifier = new Ed25519Signer();
        verifier.Init(false, new Ed25519PublicKeyParameters(pub, 0));
        verifier.BlockUpdate(message, 0, message.Length);
        return verifier.VerifySignature(signature);
    }

    public static bool VerifySha256(string filePath, string expectedHexLower)
    {
        using var stream = File.OpenRead(filePath);
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(stream);
        var hex = Convert.ToHexString(hash).ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(hex),
            System.Text.Encoding.ASCII.GetBytes(expectedHexLower));
    }

    public static bool VerifySha256(byte[] data, string expectedHexLower)
    {
        var hash = SHA256.HashData(data);
        return Convert.ToHexString(hash).ToLowerInvariant() == expectedHexLower;
    }
}
