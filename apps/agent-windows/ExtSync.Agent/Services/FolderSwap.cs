using ExtSync.Agent.Models;
using Serilog;

namespace ExtSync.Agent.Services;

/// <summary>
/// Safe replacement of the active extension folder (ADR-0004).
/// Primary strategy: directory rename swap (near-atomic on the same volume).
/// Fallback when Chrome holds a file lock: journaled in-place copy that never
/// deletes the active version before the new one is in place, and marks files
/// it could not replace as Pending Restart.
/// </summary>
public static class FolderSwap
{
    public static UpdateStepResult Replace(string activePath, string stagingPath, string rollbackPath,
                                           ILogger log)
    {
        // First install — no active folder yet.
        if (!Directory.Exists(activePath))
        {
            Directory.Move(stagingPath, activePath);
            log.Information("FolderSwap: first install moved staging -> active");
            return UpdateStepResult.Success;
        }

        // Snapshot current active to rollback BEFORE touching it (never lose it).
        SafeDelete(rollbackPath, log);
        try
        {
            // Try the fast rename swap.
            Directory.Move(activePath, rollbackPath);   // active -> rollback
            Directory.Move(stagingPath, activePath);    // staging -> active
            log.Information("FolderSwap: rename swap succeeded");
            return UpdateStepResult.Success;
        }
        catch (IOException ex)
        {
            // Chrome is most likely holding a handle inside active. Recover:
            // active is still intact (rename failed). Use journaled copy instead.
            log.Warning(ex, "FolderSwap: rename swap blocked (locked); using journaled copy");
            return JournaledCopy(activePath, stagingPath, rollbackPath, log);
        }
        catch (UnauthorizedAccessException ex)
        {
            log.Warning(ex, "FolderSwap: access denied on rename; using journaled copy");
            return JournaledCopy(activePath, stagingPath, rollbackPath, log);
        }
    }

    private static UpdateStepResult JournaledCopy(string activePath, string stagingPath,
                                                  string rollbackPath, ILogger log)
    {
        // 1. Snapshot active -> rollback by COPY (active stays usable meanwhile).
        SafeDelete(rollbackPath, log);
        CopyDir(activePath, rollbackPath);

        var journalPath = Path.Combine(Path.GetDirectoryName(activePath)!, "update.log");
        using var journal = new StreamWriter(journalPath, append: true);
        journal.WriteLine($"{DateTimeOffset.UtcNow:o} journaled-copy start");

        bool anyLocked = false;
        // 2. Overwrite/add files from staging into active.
        foreach (var src in Directory.EnumerateFiles(stagingPath, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(stagingPath, src);
            var dst = Path.Combine(activePath, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            try
            {
                File.Copy(src, dst, overwrite: true);
                journal.WriteLine($"{DateTimeOffset.UtcNow:o} wrote {rel}");
            }
            catch (IOException)
            {
                anyLocked = true;
                journal.WriteLine($"{DateTimeOffset.UtcNow:o} LOCKED {rel} (pending restart)");
                log.Warning("FolderSwap: file locked, deferring: {Rel}", rel);
            }
        }

        // 3. Remove files no longer present in staging (skip locked ones).
        var stagingFiles = Directory.EnumerateFiles(stagingPath, "*", SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(stagingPath, f)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var existing in Directory.EnumerateFiles(activePath, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(activePath, existing);
            if (rel.Equals("update.log", StringComparison.OrdinalIgnoreCase)) continue;
            if (!stagingFiles.Contains(rel))
            {
                try { File.Delete(existing); }
                catch (IOException) { /* locked; leave it */ }
            }
        }

        journal.WriteLine($"{DateTimeOffset.UtcNow:o} journaled-copy done locked={anyLocked}");
        // staging no longer needed.
        SafeDelete(stagingPath, log);
        return anyLocked ? UpdateStepResult.PendingRestart : UpdateStepResult.Success;
    }

    /// <summary>Restore the previous version from rollback into active (§14).</summary>
    public static bool RestoreFromRollback(string activePath, string rollbackPath, string failedPath, ILogger log)
    {
        if (!Directory.Exists(rollbackPath))
        {
            log.Error("RestoreFromRollback: no rollback snapshot available");
            return false;
        }
        try
        {
            // Preserve the broken version in `failed` for diagnostics (do not delete logs).
            SafeDelete(failedPath, log);
            if (Directory.Exists(activePath))
            {
                try { Directory.Move(activePath, failedPath); }
                catch (IOException) { CopyDir(activePath, failedPath); }
            }
            SafeDelete(activePath, log);
            CopyDir(rollbackPath, activePath);
            log.Information("RestoreFromRollback: restored previous version");
            return true;
        }
        catch (Exception ex)
        {
            log.Error(ex, "RestoreFromRollback failed");
            return false;
        }
    }

    public static void CopyDir(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, file);
            var target = Path.Combine(dst, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }

    private static void SafeDelete(string path, ILogger log)
    {
        if (!Directory.Exists(path)) return;
        try { Directory.Delete(path, recursive: true); }
        catch (IOException ex) { log.Warning(ex, "SafeDelete could not remove {Path}", path); }
    }
}
