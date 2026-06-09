using ExtSync.Agent.Models;
using Microsoft.Data.Sqlite;

namespace ExtSync.Agent.Services;

/// <summary>Local SQLite store — the device source of truth for installations,
/// versions, and update history (§6, §13).</summary>
public sealed class LocalStore
{
    private readonly string _connString;

    public LocalStore(string? dbPath = null)
    {
        AgentPaths.EnsureCreated();
        _connString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath ?? AgentPaths.DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        Initialize();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connString);
        c.Open();
        using var pragma = c.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;";
        pragma.ExecuteNonQuery();
        return c;
    }

    private void Initialize()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS installations (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                developer_name TEXT NOT NULL DEFAULT '',
                icon_url TEXT,
                extension_id TEXT NOT NULL DEFAULT '',
                channel TEXT NOT NULL DEFAULT 'stable',
                current_version TEXT NOT NULL DEFAULT '',
                current_release_id TEXT,
                current_sequence INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'AwaitingManualLoad',
                has_bridge INTEGER NOT NULL DEFAULT 0,
                updates_paused INTEGER NOT NULL DEFAULT 0,
                last_checked_at TEXT,
                last_updated_at TEXT,
                folder_path TEXT NOT NULL DEFAULT '',
                last_error TEXT
            );
            CREATE TABLE IF NOT EXISTS update_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                release_id TEXT,
                from_version TEXT,
                to_version TEXT,
                status TEXT NOT NULL,
                error_code TEXT,
                created_at TEXT NOT NULL
            );
            """;
        cmd.ExecuteNonQuery();
    }

    public List<LocalInstallation> GetAll()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM installations WHERE status != 'Removed'";
        using var r = cmd.ExecuteReader();
        var list = new List<LocalInstallation>();
        while (r.Read()) list.Add(Map(r));
        return list;
    }

    public LocalInstallation? Get(string projectId)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM installations WHERE project_id = $p";
        cmd.Parameters.AddWithValue("$p", projectId);
        using var r = cmd.ExecuteReader();
        return r.Read() ? Map(r) : null;
    }

    public void Upsert(LocalInstallation x)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO installations (project_id,name,developer_name,icon_url,extension_id,channel,
                current_version,current_release_id,current_sequence,status,has_bridge,updates_paused,
                last_checked_at,last_updated_at,folder_path,last_error)
            VALUES ($pid,$name,$dev,$icon,$ext,$ch,$ver,$rel,$seq,$st,$bridge,$paused,$lc,$lu,$folder,$err)
            ON CONFLICT(project_id) DO UPDATE SET
                name=$name, developer_name=$dev, icon_url=$icon, extension_id=$ext, channel=$ch,
                current_version=$ver, current_release_id=$rel, current_sequence=$seq, status=$st,
                has_bridge=$bridge, updates_paused=$paused, last_checked_at=$lc, last_updated_at=$lu,
                folder_path=$folder, last_error=$err;
            """;
        cmd.Parameters.AddWithValue("$pid", x.ProjectId);
        cmd.Parameters.AddWithValue("$name", x.Name);
        cmd.Parameters.AddWithValue("$dev", x.DeveloperName);
        cmd.Parameters.AddWithValue("$icon", (object?)x.IconUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ext", x.ExtensionId);
        cmd.Parameters.AddWithValue("$ch", x.Channel);
        cmd.Parameters.AddWithValue("$ver", x.CurrentVersion);
        cmd.Parameters.AddWithValue("$rel", (object?)x.CurrentReleaseId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$seq", x.CurrentSequence);
        cmd.Parameters.AddWithValue("$st", x.Status.ToString());
        cmd.Parameters.AddWithValue("$bridge", x.HasBridge ? 1 : 0);
        cmd.Parameters.AddWithValue("$paused", x.UpdatesPaused ? 1 : 0);
        cmd.Parameters.AddWithValue("$lc", (object?)x.LastCheckedAt?.ToString("o") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$lu", (object?)x.LastUpdatedAt?.ToString("o") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$folder", x.FolderPath);
        cmd.Parameters.AddWithValue("$err", (object?)x.LastError ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public void AddHistory(string projectId, string? releaseId, string? from, string? to,
                           string status, string? errorCode)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO update_history (project_id,release_id,from_version,to_version,status,error_code,created_at)
            VALUES ($p,$r,$f,$t,$s,$e,$c);
            """;
        cmd.Parameters.AddWithValue("$p", projectId);
        cmd.Parameters.AddWithValue("$r", (object?)releaseId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$f", (object?)from ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$t", (object?)to ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$s", status);
        cmd.Parameters.AddWithValue("$e", (object?)errorCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$c", DateTimeOffset.UtcNow.ToString("o"));
        cmd.ExecuteNonQuery();
    }

    private static LocalInstallation Map(SqliteDataReader r) => new()
    {
        ProjectId = r.GetString(r.GetOrdinal("project_id")),
        Name = r.GetString(r.GetOrdinal("name")),
        DeveloperName = r.GetString(r.GetOrdinal("developer_name")),
        IconUrl = r.IsDBNull(r.GetOrdinal("icon_url")) ? null : r.GetString(r.GetOrdinal("icon_url")),
        ExtensionId = r.GetString(r.GetOrdinal("extension_id")),
        Channel = r.GetString(r.GetOrdinal("channel")),
        CurrentVersion = r.GetString(r.GetOrdinal("current_version")),
        CurrentReleaseId = r.IsDBNull(r.GetOrdinal("current_release_id")) ? null : r.GetString(r.GetOrdinal("current_release_id")),
        CurrentSequence = r.GetInt64(r.GetOrdinal("current_sequence")),
        Status = Enum.TryParse<InstallationStatus>(r.GetString(r.GetOrdinal("status")), out var s) ? s : InstallationStatus.Broken,
        HasBridge = r.GetInt32(r.GetOrdinal("has_bridge")) == 1,
        UpdatesPaused = r.GetInt32(r.GetOrdinal("updates_paused")) == 1,
        LastCheckedAt = ParseDate(r, "last_checked_at"),
        LastUpdatedAt = ParseDate(r, "last_updated_at"),
        FolderPath = r.GetString(r.GetOrdinal("folder_path")),
        LastError = r.IsDBNull(r.GetOrdinal("last_error")) ? null : r.GetString(r.GetOrdinal("last_error")),
    };

    private static DateTimeOffset? ParseDate(SqliteDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : DateTimeOffset.Parse(r.GetString(i));
    }
}
