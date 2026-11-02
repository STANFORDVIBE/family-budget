//! Backups are complete SQLite copies made with the online backup API (consistent even while the
//! app runs). Restoring always saves the current database first, so a restore can be undone.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, MAIN_DB, OpenFlags};
use serde::Serialize;

use super::{now_millis, settings};
use crate::db::{Database, migrations};
use crate::error::{AppError, AppResult};

pub const EXTENSION: &str = "fbbak";
const AUTO_PREFIX: &str = "auto-";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub size: u64,
    pub modified_at: i64,
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub schema_version: i64,
    pub workspaces: i64,
    pub transactions: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub ok: bool,
    /// Machine-readable problem codes with counts, e.g. ("foreign_keys", 2).
    pub issues: Vec<(String, i64)>,
    pub checked_at: i64,
}

fn timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// `<prefix><timestamp>.fbbak` that does not exist yet in `dir`: an existing backup is never overwritten.
fn unique_name(dir: &Path, prefix: &str) -> String {
    let stamp = timestamp();
    let mut name = format!("{prefix}{stamp}.{EXTENSION}");
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{prefix}{stamp}-{n}.{EXTENSION}");
        n += 1;
    }
    name
}

/// Writes a consistent copy of the live database to `dest` and verifies it.
pub fn backup_to(conn: &Connection, dest: &Path) -> AppResult<BackupInfo> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Write next to the target and rename: a crash never leaves a half-written backup behind.
    let partial = dest.with_extension("partial");
    conn.backup(MAIN_DB, &partial, None::<fn(rusqlite::backup::Progress)>)?;
    let info = match verify_file(&partial) {
        Ok(info) => info,
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            return Err(e);
        }
    };
    std::fs::rename(&partial, dest)?;
    Ok(info)
}

/// Checks that a file is an intact Family Budget database this app version can open.
pub fn verify_file(path: &Path) -> AppResult<BackupInfo> {
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| AppError::InvalidBackup)?;
    let check: String =
        conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|_| AppError::InvalidBackup)?;
    if check != "ok" {
        return Err(AppError::InvalidBackup);
    }
    let version = migrations::current_version(&conn).map_err(|_| AppError::InvalidBackup)?;
    if version == 0 {
        return Err(AppError::InvalidBackup);
    }
    if version > migrations::latest_version() {
        return Err(AppError::UnsupportedVersion);
    }
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map_err(|_| AppError::InvalidBackup);
    Ok(BackupInfo {
        schema_version: version,
        workspaces: count("SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL")?,
        transactions: count("SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL")?,
    })
}

/// Replaces the live database with `source`. The current state is saved to `backup_dir` first.
/// Returns the name of that safety copy.
pub fn restore_from(db: &mut Database, source: &Path, backup_dir: &Path) -> AppResult<String> {
    verify_file(source)?;
    let safety_name = unique_name(backup_dir, "before-restore-");
    backup_to(&db.conn, &backup_dir.join(&safety_name))?;
    // The backup folder belongs to this computer, not to the data: it survives the restore
    let folder: Option<String> = settings::read(&db.conn, "backup_dir")?;
    db.conn.restore(MAIN_DB, source, None::<fn(rusqlite::backup::Progress)>).map_err(|_| AppError::InvalidBackup)?;
    // An older backup is brought up to the current schema.
    db.prepare()?;
    if !integrity(&db.conn)?.ok {
        return Err(AppError::Integrity);
    }
    match folder {
        Some(folder) => settings::write(&db.conn, "backup_dir", &folder)?,
        None => {
            db.conn.execute("DELETE FROM app_settings WHERE key = 'backup_dir'", [])?;
        }
    }
    // The safety copy above is the latest backup
    settings::write(&db.conn, "last_backup_at", &now_millis())?;
    Ok(safety_name)
}

pub fn list(dir: &Path) -> AppResult<Vec<BackupFile>> {
    let mut files = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(e) => return Err(e.into()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(EXTENSION) {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0));
        let name = entry.file_name().to_string_lossy().into_owned();
        files.push(BackupFile { automatic: name.starts_with(AUTO_PREFIX), name, size: meta.len(), modified_at });
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.modified_at));
    Ok(files)
}

/// Resolves a backup by its file name inside `dir`. Names with path parts are rejected, so the
/// UI can never point the app at an arbitrary file.
pub fn resolve(dir: &Path, name: &str) -> AppResult<PathBuf> {
    let valid = !name.is_empty()
        && !name.contains(['/', '\\', ':'])
        && !name.contains("..")
        && name.ends_with(&format!(".{EXTENSION}"));
    if !valid {
        return Err(AppError::Validation("name"));
    }
    let path = dir.join(name);
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    Ok(path)
}

pub fn manual_backup(conn: &Connection, dir: &Path) -> AppResult<String> {
    let name = unique_name(dir, "backup-");
    backup_to(conn, &dir.join(&name))?;
    settings::write(conn, "last_backup_at", &now_millis())?;
    Ok(name)
}

/// Makes a daily automatic backup if the last one is older than a day, then keeps only the
/// newest `keep` automatic copies. Manual and safety copies are never removed.
pub fn auto_backup_if_due(conn: &Connection, dir: &Path) -> AppResult<Option<String>> {
    let s = settings::get(conn)?;
    if !s.auto_backup {
        return Ok(None);
    }
    let has_user: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM users)", [], |r| r.get(0))?;
    if !has_user {
        return Ok(None);
    }
    let last: i64 = settings::read(conn, "last_auto_backup_at")?.unwrap_or(0);
    if now_millis() - last < DAY_MS {
        return Ok(None);
    }
    let name = unique_name(dir, AUTO_PREFIX);
    backup_to(conn, &dir.join(&name))?;
    settings::write(conn, "last_auto_backup_at", &now_millis())?;
    settings::write(conn, "last_backup_at", &now_millis())?;
    let autos: Vec<BackupFile> = list(dir)?.into_iter().filter(|f| f.automatic).collect();
    for old in autos.iter().skip(usize::try_from(s.backup_keep).unwrap_or(20)) {
        let _ = std::fs::remove_file(dir.join(&old.name));
    }
    Ok(Some(name))
}

/// SQLite integrity plus ledger invariants that the schema alone cannot express.
pub fn integrity(conn: &Connection) -> AppResult<IntegrityReport> {
    let mut issues = Vec::new();
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        issues.push(("sqlite_integrity".to_string(), 1));
    }
    let fk: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
    let checks: [(&str, &str); 5] = [
        ("foreign_keys", ""),
        (
            "posted_without_base_amount",
            "SELECT COUNT(*) FROM transaction_entries e JOIN transactions t ON t.id = e.transaction_id
             WHERE t.status = 'posted' AND e.base_amount_minor IS NULL",
        ),
        (
            "transaction_without_entries",
            "SELECT COUNT(*) FROM transactions t WHERE NOT EXISTS
               (SELECT 1 FROM transaction_entries e WHERE e.transaction_id = t.id AND e.role IN ('main', 'transfer_out'))",
        ),
        (
            "transfer_unbalanced",
            "SELECT COUNT(*) FROM transactions t WHERE t.kind = 'transfer' AND (
               SELECT COALESCE(SUM(e.base_amount_minor), 0) FROM transaction_entries e
               WHERE e.transaction_id = t.id AND e.role IN ('transfer_out', 'transfer_in')) <> 0",
        ),
        (
            "entry_workspace_mismatch",
            "SELECT COUNT(*) FROM transaction_entries e
             JOIN transactions t ON t.id = e.transaction_id JOIN accounts a ON a.id = e.account_id
             WHERE e.workspace_id <> t.workspace_id OR a.workspace_id <> t.workspace_id",
        ),
    ];
    for (code, sql) in checks {
        let count = if code == "foreign_keys" { fk } else { conn.query_row(sql, [], |r| r.get(0))? };
        if count > 0 {
            issues.push((code.to_string(), count));
        }
    }
    Ok(IntegrityReport { ok: issues.is_empty(), issues, checked_at: now_millis() })
}
