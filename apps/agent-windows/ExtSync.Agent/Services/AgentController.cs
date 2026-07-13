using System.Runtime.Versioning;
using System.Text.Json;
using ExtSync.Agent.Crypto;
using ExtSync.Agent.Models;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// High-level orchestration the UI calls. Wires the API client, local store,
/// update service, native messaging, and the bridge pipe together.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class AgentController
{
    private readonly AgentSettings _settings;
    private readonly LocalStore _store;
    private readonly ApiClient _api;
    private readonly UpdateService _updates;
    private readonly PipeServer _pipe;
    private readonly NativeMessagingRegistrar _nmh;
    private readonly ILogger _log;

    public event Action? InstallationsChanged;
    public bool ServerConnected { get; private set; }
    public DateTimeOffset? LastCheck { get; private set; }

    public AgentController(AgentSettings settings, LocalStore store, ApiClient api,
        UpdateService updates, PipeServer pipe, NativeMessagingRegistrar nmh, ILogger log)
    {
        _settings = settings; _store = store; _api = api; _updates = updates;
        _pipe = pipe; _nmh = nmh; _log = log;
    }

    public IReadOnlyList<LocalInstallation> Installations => _store.GetAll();

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        AgentPaths.EnsureCreated();
        _pipe.BridgeConnected += OnBridgeConnected;
        _pipe.BridgeDisconnected += OnBridgeDisconnected;
        _pipe.Start();
        RefreshNativeOrigins();

        try
        {
            if (string.IsNullOrEmpty(_settings.DeviceToken))
                await _api.RegisterDeviceAsync(ct);
            await _api.HeartbeatAsync(ct);
            ServerConnected = true;
        }
        catch (Exception ex)
        {
            ServerConnected = false;
            _log.Warning(ex, "initial server contact failed; will retry (offline mode)");
        }
        InstallationsChanged?.Invoke();
    }

    private void OnBridgeConnected(string projectId, string extensionId)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        // Do not let a pipe message OVERWRITE an established ExtensionId: a same-user local
        // process could otherwise hijack a real installation's native-host origin. Accept an
        // incoming extensionId only for a first registration or when it matches what we stored;
        // on a mismatch, ignore the message entirely (no origin refresh).
        if (!string.IsNullOrEmpty(extensionId)
            && !string.IsNullOrEmpty(inst.ExtensionId)
            && !string.Equals(inst.ExtensionId, extensionId, StringComparison.OrdinalIgnoreCase))
        {
            _log.Warning("bridge: extensionId mismatch for {Project} (have {Have}, got {Got}) - ignoring",
                projectId, inst.ExtensionId, extensionId);
            return;
        }
        inst.BridgeConnected = true;
        inst.HasBridge = true;
        if (!string.IsNullOrEmpty(extensionId) && string.IsNullOrEmpty(inst.ExtensionId))
            inst.ExtensionId = extensionId;
        // Bridge connecting confirms Chrome loaded the extension.
        if (inst.Status is InstallationStatus.AwaitingManualLoad or InstallationStatus.ReloadRequired)
            inst.Status = InstallationStatus.UpToDate;
        _store.Upsert(inst);
        RefreshNativeOrigins();
        InstallationsChanged?.Invoke();
    }

    private void OnBridgeDisconnected(string projectId)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        inst.BridgeConnected = false;
        _store.Upsert(inst);
        InstallationsChanged?.Invoke();
    }

    private void RefreshNativeOrigins()
    {
        var ids = _store.GetAll().Select(i => i.ExtensionId).Where(s => !string.IsNullOrEmpty(s));
        try { _nmh.UpdateAllowedOrigins(ids); }
        catch (Exception ex) { _log.Warning(ex, "could not update native origins"); }
    }

    // ---- install ----
    public Task<JsonElement> ResolveAsync(string token, CancellationToken ct = default) =>
        _api.ResolveInstallLinkAsync(token, ct);

    public Task<List<ApiClient.BatchItem>> ResolveBatchAsync(string token, CancellationToken ct = default) =>
        _api.ResolveInstallBatchAsync(token, ct);

    public async Task<LocalInstallation> InstallFromTokenAsync(string token, JsonElement resolved,
                                                               CancellationToken ct = default)
    {
        var extId = resolved.TryGetProperty("extensionId", out var e) ? e.GetString() : null;
        var hasBridge = resolved.TryGetProperty("hasBridge", out var b) && b.GetBoolean();

        var reg = await _api.RegisterExtensionAsync(token, extId, hasBridge, ct);
        var projectId = reg.GetProperty("projectId").GetString()!;
        var channel = reg.GetProperty("channel").GetString() ?? "stable";

        var inst = _store.Get(projectId) ?? new LocalInstallation { ProjectId = projectId };
        inst.Name = resolved.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
        inst.DeveloperName = resolved.TryGetProperty("developerName", out var d) ? d.GetString() ?? "" : "";
        inst.IconUrl = resolved.TryGetProperty("iconUrl", out var ic) ? ic.GetString() : null;
        inst.ExtensionId = extId ?? "";
        inst.Channel = channel;
        inst.HasBridge = hasBridge;
        inst.FolderPath = AgentPaths.ExtensionDir(projectId);
        Directory.CreateDirectory(inst.FolderPath);
        _store.Upsert(inst);

        if (reg.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object)
        {
            var result = await _updates.InstallInitialAsync(inst, meta, ct);
            if (result.Result == UpdateStepResult.Failed)
                throw new InvalidOperationException(result.Message ?? result.ErrorCode ?? "install failed");
        }
        inst = _store.Get(projectId)!;
        RefreshNativeOrigins();
        InstallationsChanged?.Invoke();
        return inst;
    }

    /// <summary>User confirms they loaded the unpacked folder in Chrome. For
    /// extensions without a Bridge we cannot detect the load automatically, so this
    /// flips the installation to Installed and lets the Agent manage future updates.</summary>
    public void MarkManuallyLoaded(string projectId)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        if (inst.Status is InstallationStatus.AwaitingManualLoad or InstallationStatus.ReloadRequired)
            inst.Status = InstallationStatus.Installed;
        inst.LastError = null;
        inst.LastUpdatedAt = DateTimeOffset.UtcNow;
        _store.Upsert(inst);
        InstallationsChanged?.Invoke();
    }

    // ---- updates ----
    public async Task CheckUpdatesAsync(bool autoApply, CancellationToken ct = default)
    {
        var installs = _store.GetAll().Where(i => i.Status != InstallationStatus.Removed).ToList();
        if (installs.Count == 0) { LastCheck = DateTimeOffset.UtcNow; return; }

        var items = installs.Select(i =>
            new ApiClient.CheckItem(i.ProjectId, i.Channel, i.CurrentSequence, i.CurrentVersion));
        List<ApiClient.UpdateItem> updates;
        try
        {
            updates = await _api.CheckUpdatesAsync(items, ct);
            ServerConnected = true;
        }
        catch (Exception ex)
        {
            ServerConnected = false;
            _log.Warning(ex, "check-updates failed (offline?)");
            return;
        }
        LastCheck = DateTimeOffset.UtcNow;

        foreach (var u in updates)
        {
            var inst = _store.Get(u.ProjectId);
            if (inst is null) continue;
            inst.LastCheckedAt = LastCheck;
            if (u.Available && u.Metadata is { } meta)
            {
                if (inst.UpdatesPaused || !autoApply)
                {
                    inst.Status = InstallationStatus.UpdateAvailable;
                    _store.Upsert(inst);
                }
                else
                {
                    var requiresApproval = meta.TryGetProperty("requiresUserApproval", out var ra) && ra.GetBoolean();
                    // Permission-gated updates are not auto-applied; surface to the user (§15).
                    await _updates.ApplyUpdateAsync(inst, meta, userApproved: !requiresApproval, ct);
                }
            }
            else
            {
                _store.Upsert(inst);
            }
        }
        InstallationsChanged?.Invoke();
    }

    public async Task ApplyUpdateAsync(string projectId, JsonElement meta, bool userApproved, CancellationToken ct = default)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        await _updates.ApplyUpdateAsync(inst, meta, userApproved, ct);
        InstallationsChanged?.Invoke();
    }

    public void SetPaused(string projectId, bool paused)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        inst.UpdatesPaused = paused;
        _store.Upsert(inst);
        InstallationsChanged?.Invoke();
    }

    public void SetChannel(string projectId, string channel)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        inst.Channel = channel;
        _store.Upsert(inst);
        InstallationsChanged?.Invoke();
    }

    /// <summary>Local rollback to the retained previous version (§14).</summary>
    public async Task<bool> RollbackAsync(string projectId, CancellationToken ct = default)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return false;
        inst.Status = InstallationStatus.RollbackInProgress;
        _store.Upsert(inst);
        var failed = Path.Combine(inst.FolderPath, "failed");
        var ok = FolderSwap.RestoreFromRollback(inst.ActivePath, inst.RollbackPath, failed, _log);
        if (ok && inst.HasBridge)
            await _pipe.RequestReloadAsync(projectId, inst.CurrentVersion, TimeSpan.FromSeconds(15));
        inst.Status = ok ? InstallationStatus.UpToDate : InstallationStatus.Broken;
        inst.LastError = ok ? null : "rollback failed";
        _store.Upsert(inst);
        _store.AddHistory(projectId, inst.CurrentReleaseId, null, inst.CurrentVersion,
            ok ? "rolled_back" : "rollback_failed", ok ? null : ErrorCodes.RollbackFailed);
        InstallationsChanged?.Invoke();
        return ok;
    }

    public async Task RemoveAsync(string projectId, bool deleteFiles, CancellationToken ct = default)
    {
        var inst = _store.Get(projectId);
        if (inst is null) return;
        try { await _api.UnregisterExtensionAsync(projectId, deleteFiles, ct); }
        catch (Exception ex) { _log.Warning(ex, "server unregister failed"); }

        inst.Status = InstallationStatus.Removed;
        _store.Upsert(inst);
        _pipe.ClearPendingReload(projectId);
        // Deleting files requires explicit user opt-in (§45 #20).
        if (deleteFiles && Directory.Exists(inst.FolderPath))
        {
            try { Directory.Delete(inst.FolderPath, recursive: true); }
            catch (Exception ex) { _log.Warning(ex, "could not delete files"); }
        }
        RefreshNativeOrigins();
        InstallationsChanged?.Invoke();
    }
}
