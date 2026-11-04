use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Change, clean_required, current_user, new_id, now_millis, record_change, settings};
use crate::db::seed;
use crate::domain::dates::{format_date, today};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_currency: String,
    pub created_at: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub name: String,
    pub kind: String,
    pub base_currency: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdate {
    pub name: String,
    pub base_currency: String,
}

const COLUMNS: &str = "id, name, kind, base_currency, created_at, version";

fn from_row(r: &Row) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        base_currency: r.get(3)?,
        created_at: r.get(4)?,
        version: r.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM workspaces WHERE deleted_at IS NULL
         ORDER BY CASE kind WHEN 'personal' THEN 0 ELSE 1 END, created_at"
    ))?;
    let rows = stmt.query_map([], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Workspace> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM workspaces WHERE id = ?1 AND deleted_at IS NULL"), [id], from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

fn validate_kind(kind: &str) -> AppResult<()> {
    if matches!(kind, "personal" | "family") { Ok(()) } else { Err(AppError::Validation("kind")) }
}

/// Creates a workspace with its owner member and the default category set.
/// Runs inside the caller's transaction.
pub fn create_in(conn: &Connection, input: &WorkspaceInput) -> AppResult<Workspace> {
    let name = clean_required(&input.name, 60, "name")?;
    validate_kind(&input.kind)?;
    super::currency_decimals(conn, &input.base_currency)?;
    let user_id = current_user(conn)?;
    let user_name: String = conn.query_row("SELECT name FROM users WHERE id = ?1", [&user_id], |r| r.get(0))?;
    let now = now_millis();
    let id = new_id();
    conn.execute(
        "INSERT INTO workspaces (id, name, kind, base_currency, owner_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, input.kind, input.base_currency, user_id, now],
    )?;
    conn.execute(
        "INSERT INTO workspace_members (id, workspace_id, user_id, name, role, status, joined_on, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'owner', 'active', ?5, ?6, ?6)",
        params![new_id(), id, user_id, user_name, format_date(today()), now],
    )?;
    seed_categories(conn, &id, now)?;
    let workspace = get(conn, &id)?;
    record_change(
        conn,
        Change {
            workspace_id: Some(&id),
            entity: "workspace",
            entity_id: &id,
            action: "create",
            version: workspace.version,
            old: None,
            new: Some(&workspace),
        },
    )?;
    Ok(workspace)
}

fn seed_categories(conn: &Connection, workspace_id: &str, now: i64) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO categories (id, workspace_id, kind, name, icon, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
    )?;
    for (kind, set) in [("expense", seed::EXPENSE_CATEGORIES), ("income", seed::INCOME_CATEGORIES)] {
        for (order, (name, icon, color)) in set.iter().enumerate() {
            stmt.execute(params![new_id(), workspace_id, kind, name, icon, color, order as i64, now])?;
        }
    }
    Ok(())
}

pub fn create(conn: &mut Connection, input: &WorkspaceInput) -> AppResult<Workspace> {
    let tx = conn.transaction()?;
    let workspace = create_in(&tx, input)?;
    tx.commit()?;
    Ok(workspace)
}

/// Renames a workspace or changes its base currency. The base currency is fixed once the
/// workspace has operations: their base amounts were computed with the old one.
pub fn update(conn: &mut Connection, id: &str, input: &WorkspaceUpdate) -> AppResult<Workspace> {
    let tx = conn.transaction()?;
    let old = get(&tx, id)?;
    let name = clean_required(&input.name, 60, "name")?;
    super::currency_decimals(&tx, &input.base_currency)?;
    if input.base_currency != old.base_currency {
        let has_history: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM transactions WHERE workspace_id = ?1 AND deleted_at IS NULL)",
            [id],
            |r| r.get(0),
        )?;
        if has_history {
            return Err(AppError::Conflict("base_currency_has_history"));
        }
    }
    tx.execute(
        "UPDATE workspaces SET name = ?1, base_currency = ?2, updated_at = ?3, version = version + 1 WHERE id = ?4",
        params![name, input.base_currency, now_millis(), id],
    )?;
    let new = get(&tx, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(id),
            entity: "workspace",
            entity_id: id,
            action: "update",
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

/// Hides a workspace with everything in it. Its rows stay in the database and in backups, so a
/// restore brings it back. The last workspace cannot be deleted: the app needs one to work in.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get(&tx, id)?;
    let remaining: i64 = tx.query_row("SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL", [], |r| r.get(0))?;
    if remaining <= 1 {
        return Err(AppError::Conflict("last_workspace"));
    }
    tx.execute(
        "UPDATE workspaces SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now_millis(), id],
    )?;
    let active: Option<String> = settings::read(&tx, "active_workspace_id")?;
    if active.as_deref() == Some(id) {
        tx.execute("DELETE FROM app_settings WHERE key = 'active_workspace_id'", [])?;
    }
    record_change(
        &tx,
        Change::<Workspace> {
            workspace_id: Some(id),
            entity: "workspace",
            entity_id: id,
            action: "delete",
            version: old.version + 1,
            old: Some(&old),
            new: None,
        },
    )?;
    tx.commit()?;
    Ok(())
}
