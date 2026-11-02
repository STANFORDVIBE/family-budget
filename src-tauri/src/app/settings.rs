//! App settings, stored as JSON values in `app_settings`.

use rusqlite::{Connection, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::now_millis;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub date_format: String,
    pub number_format: String,
    pub hide_amounts: bool,
    pub auto_backup: bool,
    pub backup_keep: i64,
    /// Chosen only through the system folder dialog, never typed in by the UI.
    pub backup_dir: Option<String>,
    pub active_workspace_id: Option<String>,
}

/// The part of the settings the UI may change directly.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub date_format: Option<String>,
    pub number_format: Option<String>,
    pub hide_amounts: Option<bool>,
    pub auto_backup: Option<bool>,
    pub backup_keep: Option<i64>,
    pub active_workspace_id: Option<String>,
}

/// What the operation form remembers per workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FormMemory {
    pub last_kind: Option<String>,
    pub last_account_id: Option<String>,
}

pub fn read<T: DeserializeOwned>(conn: &Connection, key: &str) -> AppResult<Option<T>> {
    let raw: Option<String> =
        conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    // A damaged value falls back to the default instead of breaking the app.
    Ok(raw.and_then(|v| serde_json::from_str(&v).ok()))
}

pub fn write<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, serde_json::to_string(value)?, now_millis()],
    )?;
    Ok(())
}

pub fn get(conn: &Connection) -> AppResult<Settings> {
    Ok(Settings {
        theme: read(conn, "theme")?.unwrap_or_else(|| "system".into()),
        language: read(conn, "language")?.unwrap_or_else(|| "ru".into()),
        date_format: read(conn, "date_format")?.unwrap_or_else(|| "dd.MM.yyyy".into()),
        number_format: read(conn, "number_format")?.unwrap_or_else(|| "space_comma".into()),
        hide_amounts: read(conn, "hide_amounts")?.unwrap_or(false),
        auto_backup: read(conn, "auto_backup")?.unwrap_or(true),
        backup_keep: read(conn, "backup_keep")?.unwrap_or(20),
        backup_dir: read(conn, "backup_dir")?,
        active_workspace_id: read(conn, "active_workspace_id")?,
    })
}

fn one_of(value: &str, allowed: &[&str], field: &'static str) -> AppResult<()> {
    if allowed.contains(&value) { Ok(()) } else { Err(AppError::Validation(field)) }
}

pub fn update(conn: &mut Connection, input: &SettingsUpdate) -> AppResult<Settings> {
    let tx = conn.transaction()?;
    if let Some(v) = &input.theme {
        one_of(v, &["light", "dark", "system"], "theme")?;
        write(&tx, "theme", v)?;
    }
    if let Some(v) = &input.language {
        one_of(v, &["ru", "en"], "language")?;
        write(&tx, "language", v)?;
    }
    if let Some(v) = &input.date_format {
        one_of(v, &["dd.MM.yyyy", "yyyy-MM-dd", "MM/dd/yyyy"], "date_format")?;
        write(&tx, "date_format", v)?;
    }
    if let Some(v) = &input.number_format {
        one_of(v, &["space_comma", "comma_dot", "dot_comma"], "number_format")?;
        write(&tx, "number_format", v)?;
    }
    if let Some(v) = input.hide_amounts {
        write(&tx, "hide_amounts", &v)?;
    }
    if let Some(v) = input.auto_backup {
        write(&tx, "auto_backup", &v)?;
    }
    if let Some(v) = input.backup_keep {
        if !(3..=200).contains(&v) {
            return Err(AppError::Validation("backup_keep"));
        }
        write(&tx, "backup_keep", &v)?;
    }
    if let Some(id) = &input.active_workspace_id {
        let exists: bool =
            tx.query_row("SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ?1 AND deleted_at IS NULL)", [id], |r| {
                r.get(0)
            })?;
        if !exists {
            return Err(AppError::Validation("active_workspace_id"));
        }
        write(&tx, "active_workspace_id", id)?;
    }
    let settings = get(&tx)?;
    tx.commit()?;
    Ok(settings)
}

pub fn form_memory(conn: &Connection, workspace_id: &str) -> AppResult<FormMemory> {
    Ok(read(conn, &format!("form:{workspace_id}"))?.unwrap_or_default())
}

pub fn remember_form(conn: &Connection, workspace_id: &str, kind: &str, account_id: &str) -> AppResult<()> {
    let memory = FormMemory { last_kind: Some(kind.to_string()), last_account_id: Some(account_id.to_string()) };
    write(conn, &format!("form:{workspace_id}"), &memory)
}
