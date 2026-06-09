using System.IO.Compression;
using System.Text.Json;
using ExtSync.Agent.Crypto;
using ExtSync.Agent.Models;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// The local update state machine (§13). Verifies signature + hash, stages,
/// swaps safely with rollback retained, requests a verified reload, and reports
/// to the server. Never deletes the active version before the new one is in
/// place and verified. Per-project locked to avoid concurrent updates.
/// </summary>
public sealed class UpdateService
{
    private readonly ApiClient _api;
    private readonly ReleaseVerifier _verifier;
    private readonly PipeServer _pipe;
    private readonly LocalStore _store;
    private readonly AgentSettings _settings;
    private readonly HttpClient _http;
    private readonly ILogger _log;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public UpdateService(ApiClient api, ReleaseVerifier verifier, PipeServer pipe,
                         LocalStore store, AgentSettings settings, HttpClient http, ILogger log)
    {
        _api = api; _verifier = verifier; _pipe = pipe; _store = store;
        _settings = settings; _http = http; _log = log;
    }

    public sealed record ApplyResult(UpdateStepResult Result, string? ErrorCode = null, string? Message = null);

    /// <summary>First-time install: verify + download + extract straight into the
    /// active folder. No swap/reload — the user will load it manually in Chrome
    /// (§1, §17). Returns the active folder path on success.</summary>
    public async Task<ApplyResult> InstallInitialAsync(LocalInstallation inst, JsonElement metaEl,
                                                       CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var meta = ReleaseMetadata.FromJson(metaEl);
            if (meta.ProjectId != inst.ProjectId)
                return new ApplyResult(UpdateStepResult.Failed, ErrorCodes.ProjectIdMismatch);
            if (!_verifier.VerifyMetadata(metaEl))
                return new ApplyResult(UpdateStepResult.Failed, ErrorCodes.InvalidSignature,
                    "חתימת המטא-דאטה אינה תקינה");

            var tempZip = Path.Combine(AgentPaths.TempDir, $"{meta.ReleaseId}.zip");
            try
            {
                inst.Status = InstallationStatus.Downloading;
                _store.Upsert(inst);
                await DownloadAsync(meta.Artifact.Url, tempZip, meta.Artifact.Size, ct);
                if (new FileInfo(tempZip).Length > meta.Artifact.Size)
                    return new ApplyResult(UpdateStepResult.Failed, ErrorCodes.SizeExceeded);
                if (!ReleaseVerifier.VerifySha256(tempZip, meta.Artifact.Sha256))
                    return new ApplyResult(UpdateStepResult.Failed, ErrorCodes.HashMismatch);

                SafeClear(inst.ActivePath);
                ExtractZipSafely(tempZip, inst.ActivePath);
                var (okLocal, localErr) = LocalValidate(inst.ActivePath, meta);
                if (!okLocal) return new ApplyResult(UpdateStepResult.Failed, localErr);

                inst.CurrentVersion = meta.Version;
                inst.CurrentReleaseId = meta.ReleaseId;
                inst.CurrentSequence = meta.Sequence;
                inst.Status = InstallationStatus.AwaitingManualLoad;
                inst.LastUpdatedAt = DateTimeOffset.UtcNow;
                _store.Upsert(inst);
                _store.AddHistory(inst.ProjectId, meta.ReleaseId, null, meta.Version, "installed", null);
                _log.Information("initial install staged to active {Project} v{Version}",
                    inst.ProjectId, meta.Version);
                return new ApplyResult(UpdateStepResult.Success);
            }
            finally
            {
                try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { /* best effort */ }
            }
        }
        finally { _gate.Release(); }
    }

    public async Task<ApplyResult> ApplyUpdateAsync(LocalInstallation inst, JsonElement metaEl,
                                                    bool userApproved, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await ApplyInternalAsync(inst, metaEl, userApproved, ct);
        }
        finally { _gate.Release(); }
    }

    private async Task<ApplyResult> ApplyInternalAsync(LocalInstallation inst, JsonElement metaEl,
                                                       bool userApproved, CancellationToken ct)
    {
        var meta = ReleaseMetadata.FromJson(metaEl);

        // (3) still relevant + idempotent
        if (!meta.Rollback && meta.Sequence <= inst.CurrentSequence)
        {
            _log.Information("update {Project} seq {Seq} not newer than {Cur}; skip",
                inst.ProjectId, meta.Sequence, inst.CurrentSequence);
            return new ApplyResult(UpdateStepResult.Success);
        }
        if (meta.ProjectId != inst.ProjectId)
            return Fail(inst, meta, ErrorCodes.ProjectIdMismatch, "projectId mismatch");
        if (!VersionUtil.Gte(_settings.AgentVersion, meta.MinimumAgentVersion))
            return Fail(inst, meta, ErrorCodes.AgentUpdateRequired, "agent too old");

        // (15-policy) permission approval gate
        if (meta.RequiresUserApproval && !userApproved)
            return new ApplyResult(UpdateStepResult.Failed, ErrorCodes.PermissionApprovalRequired,
                "נדרש אישור הרשאות לפני התקנת העדכון");

        // (7) verify signature BEFORE trusting any field for download
        if (!_verifier.VerifyMetadata(metaEl))
            return Fail(inst, meta, ErrorCodes.InvalidSignature, "חתימת המטא-דאטה אינה תקינה");

        inst.Status = InstallationStatus.Updating;
        inst.LastError = null;
        _store.Upsert(inst);

        var tempZip = Path.Combine(AgentPaths.TempDir, $"{meta.ReleaseId}.zip");
        try
        {
            // (4) download
            await DownloadAsync(meta.Artifact.Url, tempZip, meta.Artifact.Size, ct);

            // (5) size
            var size = new FileInfo(tempZip).Length;
            if (size > meta.Artifact.Size)
                return Fail(inst, meta, ErrorCodes.SizeExceeded, "הקובץ גדול מהמוצהר");

            // (6) hash
            if (!ReleaseVerifier.VerifySha256(tempZip, meta.Artifact.Sha256))
                return Fail(inst, meta, ErrorCodes.HashMismatch, "ה-hash אינו תואם");

            // (8) extract to staging
            var staging = inst.StagingPath;
            SafeClear(staging);
            ExtractZipSafely(tempZip, staging);

            // (9-11) local validation
            var (okLocal, localErr) = LocalValidate(staging, meta);
            if (!okLocal) return Fail(inst, meta, localErr!, "החבילה לא עברה בדיקה מקומית");

            // (12-13) swap with rollback retained
            var swap = FolderSwap.Replace(inst.ActivePath, staging, inst.RollbackPath, _log);

            // (14) persist local state
            inst.CurrentVersion = meta.Version;
            inst.CurrentReleaseId = meta.ReleaseId;
            inst.CurrentSequence = meta.Sequence;
            inst.LastUpdatedAt = DateTimeOffset.UtcNow;

            // (15-16) request a verified reload via the Bridge
            bool reloaded = false;
            if (swap == UpdateStepResult.Success && inst.HasBridge && _pipe.IsBridgeConnected(inst.ProjectId))
            {
                reloaded = await _pipe.RequestReloadAsync(inst.ProjectId, meta.Version, TimeSpan.FromSeconds(15));
            }

            inst.Status = (swap == UpdateStepResult.Success && reloaded)
                ? InstallationStatus.UpToDate
                : InstallationStatus.ReloadRequired; // Pending Restart (§13, no-bridge or locked)
            _store.Upsert(inst);
            _store.AddHistory(inst.ProjectId, meta.ReleaseId, null, meta.Version,
                inst.Status.ToString(), null);

            // (17) report success
            await ReportAsync(inst.ProjectId, meta, "success", reloaded, null, inst.Status, ct);
            _log.Information("update applied {Project} -> {Version} ({Status})",
                inst.ProjectId, meta.Version, inst.Status);
            return new ApplyResult(swap == UpdateStepResult.PendingRestart
                ? UpdateStepResult.PendingRestart : UpdateStepResult.Success);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "update failed {Project}", inst.ProjectId);
            // (18) recover: roll back to the retained previous version
            var rolledBack = TryRollback(inst);
            await ReportAsync(inst.ProjectId, meta, rolledBack ? "rolled_back" : "failed",
                false, ErrorCodes.DownloadFailed, inst.Status, ct);
            return new ApplyResult(rolledBack ? UpdateStepResult.RolledBack : UpdateStepResult.Failed,
                ErrorCodes.DownloadFailed, ex.Message);
        }
        finally
        {
            try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { /* best effort */ }
        }
    }

    private bool TryRollback(LocalInstallation inst)
    {
        inst.Status = InstallationStatus.RollbackInProgress;
        _store.Upsert(inst);
        var failedPath = Path.Combine(inst.FolderPath, "failed");
        var ok = FolderSwap.RestoreFromRollback(inst.ActivePath, inst.RollbackPath, failedPath, _log);
        inst.Status = ok ? InstallationStatus.UpToDate : InstallationStatus.Broken;
        inst.LastError = ok ? "rolled back after failed update" : "rollback failed";
        _store.Upsert(inst);
        _store.AddHistory(inst.ProjectId, inst.CurrentReleaseId, null, inst.CurrentVersion,
            ok ? "rolled_back" : "rollback_failed", ok ? null : ErrorCodes.RollbackFailed);
        return ok;
    }

    private ApplyResult Fail(LocalInstallation inst, ReleaseMetadata meta, string code, string message)
    {
        inst.Status = inst.CurrentSequence > 0 ? InstallationStatus.UpToDate : InstallationStatus.AwaitingManualLoad;
        inst.LastError = $"{code}: {message}";
        _store.Upsert(inst);
        _log.Warning("update rejected {Project} {Code}: {Message}", inst.ProjectId, code, message);
        _ = ReportAsync(inst.ProjectId, meta, "failed", false, code, inst.Status, CancellationToken.None);
        return new ApplyResult(UpdateStepResult.Failed, code, message);
    }

    private async Task DownloadAsync(string url, string dest, long expectedSize, CancellationToken ct)
    {
        using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();
        // Guard against a server lying about size: stop if the stream exceeds it.
        await using var src = await resp.Content.ReadAsStreamAsync(ct);
        await using var dst = File.Create(dest);
        var buffer = new byte[81920];
        long total = 0;
        int read;
        var cap = expectedSize > 0 ? expectedSize + 1 : long.MaxValue;
        while ((read = await src.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > cap) throw new InvalidOperationException("artifact exceeds declared size");
            await dst.WriteAsync(buffer.AsMemory(0, read), ct);
        }
    }

    private static void ExtractZipSafely(string zipPath, string destDir)
    {
        Directory.CreateDirectory(destDir);
        using var archive = ZipFile.OpenRead(zipPath);
        var fullDest = Path.GetFullPath(destDir + Path.DirectorySeparatorChar);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue; // directory entry
            var target = Path.GetFullPath(Path.Combine(destDir, entry.FullName));
            // Defense in depth against path traversal (Zip Slip).
            if (!target.StartsWith(fullDest, StringComparison.Ordinal))
                throw new InvalidOperationException($"unsafe zip entry: {entry.FullName}");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, overwrite: true);
        }
    }

    private static (bool, string?) LocalValidate(string dir, ReleaseMetadata meta)
    {
        var manifestPath = Path.Combine(dir, "manifest.json");
        if (!File.Exists(manifestPath)) return (false, ErrorCodes.InvalidManifest);
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var root = doc.RootElement;
            if (!root.TryGetProperty("version", out var v) || v.GetString() != meta.Version)
                return (false, ErrorCodes.InvalidManifest);
        }
        catch (JsonException) { return (false, ErrorCodes.InvalidManifest); }

        // No unexpected binaries.
        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext is ".exe" or ".dll" or ".msi" or ".bat" or ".cmd" or ".scr")
                return (false, ErrorCodes.InvalidArchive);
        }
        return (true, null);
    }

    private async Task ReportAsync(string projectId, ReleaseMetadata meta, string status,
                                   bool reloaded, string? errorCode, InstallationStatus newStatus, CancellationToken ct)
    {
        try
        {
            await _api.ReportUpdateAsync(new ApiClient.ReportUpdate(
                projectId, meta.ReleaseId, meta.ReleaseId /* idempotency key */,
                null, meta.Version, status, errorCode, reloaded, newStatus.ToString()), ct);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "failed to report update status to server (will retry on next sync)");
        }
    }

    private static void SafeClear(string dir)
    {
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        Directory.CreateDirectory(dir);
    }
}
