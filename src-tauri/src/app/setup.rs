//! First launch: the local user and their first workspaces.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::workspaces::{self, Workspace, WorkspaceInput};
use super::{Change, clean_required, new_id, now_millis, record_change};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Currency {
    pub code: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingInput {
    pub user_name: String,
    pub personal_name: String,
    pub base_currency: String,
    /// Optional family workspace created right away.
    pub family_name: Option<String>,
}

pub fn user(conn: &Connection) -> AppResult<Option<User>> {
    Ok(conn
        .query_row("SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1", [], |r| {
            Ok(User { id: r.get(0)?, name: r.get(1)? })
        })
        .optional()?)
}

pub fn currencies(conn: &Connection) -> AppResult<Vec<Currency>> {
    let mut stmt = conn.prepare("SELECT code, name, symbol, decimals FROM currencies ORDER BY code")?;
    let rows = stmt
        .query_map([], |r| Ok(Currency { code: r.get(0)?, name: r.get(1)?, symbol: r.get(2)?, decimals: r.get(3)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Creates the user, the personal workspace and optionally a family one, atomically.
pub fn complete_onboarding(conn: &mut Connection, input: &OnboardingInput) -> AppResult<Vec<Workspace>> {
    let tx = conn.transaction()?;
    if user(&tx)?.is_some() {
        return Err(AppError::Conflict("already_initialized"));
    }
    let name = clean_required(&input.user_name, 60, "user_name")?;
    let id = new_id();
    let now = now_millis();
    tx.execute("INSERT INTO users (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", params![id, name, now])?;
    let created = User { id: id.clone(), name };
    record_change(
        &tx,
        Change {
            workspace_id: None,
            entity: "user",
            entity_id: &id,
            action: "create",
            version: 1,
            old: None,
            new: Some(&created),
        },
    )?;

    let mut result = vec![workspaces::create_in(
        &tx,
        &WorkspaceInput {
            name: input.personal_name.clone(),
            kind: "personal".into(),
            base_currency: input.base_currency.clone(),
        },
    )?];
    if let Some(family) = input.family_name.as_deref().filter(|n| !n.trim().is_empty()) {
        result.push(workspaces::create_in(
            &tx,
            &WorkspaceInput {
                name: family.to_string(),
                kind: "family".into(),
                base_currency: input.base_currency.clone(),
            },
        )?);
    }
    tx.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('active_workspace_id', ?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![serde_json::to_string(&result[0].id)?, now],
    )?;
    tx.commit()?;
    Ok(result)
}

pub fn rename_user(conn: &mut Connection, name: &str) -> AppResult<User> {
    let tx = conn.transaction()?;
    let old = user(&tx)?.ok_or(AppError::NotInitialized)?;
    let name = clean_required(name, 60, "user_name")?;
    tx.execute(
        "UPDATE users SET name = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
        params![name, now_millis(), old.id],
    )?;
    // The owner's member record carries the same name in every workspace.
    tx.execute(
        "UPDATE workspace_members SET name = ?1, updated_at = ?2, version = version + 1 WHERE user_id = ?3",
        params![name, now_millis(), old.id],
    )?;
    let new = User { id: old.id.clone(), name };
    let version: i64 = tx.query_row("SELECT version FROM users WHERE id = ?1", [&old.id], |r| r.get(0))?;
    record_change(
        &tx,
        Change {
            workspace_id: None,
            entity: "user",
            entity_id: &old.id,
            action: "update",
            version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}
