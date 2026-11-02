//! Application layer: use cases. Each write runs in one SQLite transaction together with its
//! audit record and sync bookkeeping, so a failure never leaves half an operation behind.

pub mod accounts;
pub mod analytics;
pub mod audit;
pub mod backup;
pub mod budgets;
pub mod categories;
pub mod export;
pub mod goals;
pub mod members;
pub mod rates;
pub mod recurring;
pub mod settings;
pub mod setup;
pub mod transactions;
pub mod workspaces;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::domain::ledger::BaseCurrency;
use crate::error::{AppError, AppResult};

pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Time-ordered UUID (v7): unique across devices, which future sync relies on.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Accepts a client-generated id (used for idempotent creates) only if it is a real UUID.
pub fn id_or_new(id: Option<&str>) -> AppResult<String> {
    match id {
        Some(id) => uuid::Uuid::parse_str(id).map(|u| u.to_string()).map_err(|_| AppError::Validation("id")),
        None => Ok(new_id()),
    }
}

/// The local user. Version 1.0 has exactly one, created on first launch.
pub fn current_user(conn: &Connection) -> AppResult<String> {
    conn.query_row("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1", [], |r| r.get(0))
        .optional()?
        .ok_or(AppError::NotInitialized)
}

/// Trims user text and enforces a length limit; empty → error for required fields.
pub fn clean_required(text: &str, max: usize, field: &'static str) -> AppResult<String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > max {
        return Err(AppError::Validation(field));
    }
    Ok(text.to_string())
}

pub fn clean_optional(text: Option<&str>, max: usize, field: &'static str) -> AppResult<Option<String>> {
    match text.map(str::trim).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(t) if t.chars().count() > max => Err(AppError::Validation(field)),
        Some(t) => Ok(Some(t.to_string())),
    }
}

/// '#rrggbb' colors only: they end up in inline styles.
pub fn clean_color(color: &str) -> AppResult<String> {
    let ok = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !ok {
        return Err(AppError::Validation("color"));
    }
    Ok(color.to_ascii_lowercase())
}

/// Icon names are lucide identifiers: lowercase letters, digits and dashes.
pub fn clean_icon(icon: &str) -> AppResult<String> {
    let ok = !icon.is_empty()
        && icon.len() <= 40
        && icon.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !ok {
        return Err(AppError::Validation("icon"));
    }
    Ok(icon.to_string())
}

pub fn currency_decimals(conn: &Connection, code: &str) -> AppResult<u32> {
    let decimals: Option<u32> =
        conn.query_row("SELECT decimals FROM currencies WHERE code = ?1", [code], |r| r.get(0)).optional()?;
    decimals.ok_or(AppError::Validation("currency"))
}

pub fn workspace_base(conn: &Connection, workspace_id: &str) -> AppResult<BaseCurrency> {
    let code: String = conn
        .query_row("SELECT base_currency FROM workspaces WHERE id = ?1 AND deleted_at IS NULL", [workspace_id], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or(AppError::NotFound)?;
    let decimals = currency_decimals(conn, &code)?;
    Ok(BaseCurrency { code, decimals })
}

/// Fails unless the row exists, is not deleted and belongs to the workspace.
/// This is the single gate that keeps personal and family data apart.
pub fn ensure_in_workspace(conn: &Connection, table: Table, id: &str, workspace_id: &str) -> AppResult<()> {
    let sql = format!(
        "SELECT EXISTS (SELECT 1 FROM {} WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL)",
        table.name()
    );
    let exists: bool = conn.query_row(&sql, params![id, workspace_id], |r| r.get(0))?;
    if exists { Ok(()) } else { Err(AppError::NotFound) }
}

/// Tables that `ensure_in_workspace` may query; a closed list keeps table names out of user input.
#[derive(Debug, Clone, Copy)]
pub enum Table {
    Accounts,
    Categories,
    Members,
    Transactions,
    Recurring,
    Goals,
    Budgets,
    Rates,
}

impl Table {
    fn name(self) -> &'static str {
        match self {
            Table::Accounts => "accounts",
            Table::Categories => "categories",
            Table::Members => "workspace_members",
            Table::Transactions => "transactions",
            Table::Recurring => "recurring_rules",
            Table::Goals => "goals",
            Table::Budgets => "budgets",
            Table::Rates => "exchange_rates",
        }
    }
}

/// Records a change for the audit journal and for future synchronization.
pub fn record_change<T: Serialize>(conn: &Connection, change: Change<'_, T>) -> AppResult<()> {
    let user = current_user(conn).ok();
    let old = change.old.map(serde_json::to_string).transpose()?;
    let new = change.new.map(serde_json::to_string).transpose()?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO audit_log (id, workspace_id, user_id, entity, entity_id, action, old_value, new_value, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![new_id(), change.workspace_id, user, change.entity, change.entity_id, change.action, old, new, now],
    )?;
    conn.execute(
        "INSERT INTO sync_metadata (entity, entity_id, workspace_id, local_version, dirty, changed_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)
         ON CONFLICT (entity, entity_id) DO UPDATE SET
             local_version = excluded.local_version, dirty = 1, changed_at = excluded.changed_at",
        params![change.entity, change.entity_id, change.workspace_id, change.version, now],
    )?;
    Ok(())
}

pub struct Change<'a, T: Serialize> {
    pub workspace_id: Option<&'a str>,
    pub entity: &'static str,
    pub entity_id: &'a str,
    pub action: &'static str,
    pub version: i64,
    pub old: Option<&'a T>,
    pub new: Option<&'a T>,
}

#[cfg(test)]
pub mod testing;

#[cfg(test)]
mod scenarios;
