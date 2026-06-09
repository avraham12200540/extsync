using System.Text.Json;
using System.Text.Json.Serialization;

namespace ExtSync.Agent.Models;

/// <summary>Mirror of packages/release-schema release-metadata. Kept as a typed
/// view; signature verification always operates on the original JSON element.</summary>
public sealed class ReleaseMetadata
{
    [JsonPropertyName("schema")] public int Schema { get; set; }
    [JsonPropertyName("releaseId")] public string ReleaseId { get; set; } = "";
    [JsonPropertyName("projectId")] public string ProjectId { get; set; } = "";
    [JsonPropertyName("extensionId")] public string ExtensionId { get; set; } = "";
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("channel")] public string Channel { get; set; } = "stable";
    [JsonPropertyName("minimumAgentVersion")] public string MinimumAgentVersion { get; set; } = "1.0.0";
    [JsonPropertyName("artifact")] public ArtifactRef Artifact { get; set; } = new();
    [JsonPropertyName("sequence")] public long Sequence { get; set; }
    [JsonPropertyName("rollback")] public bool Rollback { get; set; }
    [JsonPropertyName("rolloutPercentage")] public int RolloutPercentage { get; set; } = 100;
    [JsonPropertyName("permissionsChanged")] public bool PermissionsChanged { get; set; }
    [JsonPropertyName("requiresUserApproval")] public bool RequiresUserApproval { get; set; }
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; set; } = "";
    [JsonPropertyName("keyId")] public string KeyId { get; set; } = "";
    [JsonPropertyName("signature")] public string Signature { get; set; } = "";

    public sealed class ArtifactRef
    {
        [JsonPropertyName("url")] public string Url { get; set; } = "";
        [JsonPropertyName("size")] public long Size { get; set; }
        [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    }

    public static ReleaseMetadata FromJson(JsonElement el) =>
        el.Deserialize<ReleaseMetadata>() ?? throw new InvalidOperationException("bad metadata");
}
