//! Members of a workspace. In 1.0 they are local profiles (who spent, who earned); the
//! `user_id` link is where cloud accounts will attach later.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Change, clean_required, new_id, now_millis, record_change};
use crate::domain::dates::{format_date, today};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub role: String,
    pub status: String,
    pub joined_on: String,
    pub is_me: bool,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberInput {
    pub name: String,
    pub role: String,
    pub status: Option<String>,
}

const COLUMNS: &str = "id, workspace_id, name, role, status, joined_on, user_id IS NOT NULL, version";

fn from_row(r: &Row) -> rusqlite::Result<Member> {
    Ok(Member {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        name: r.get(2)?,
        role: r.get(3)?,
        status: r.get(4)?,
        joined_on: r.get(5)?,
        is_me: r.get(6)?,
        version: r.get(7)?,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<Member>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM workspace_members WHERE workspace_id = ?1 AND deleted_at IS NULL
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, created_at"
    ))?;
    let rows = stmt.query_map([workspace_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Member> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM workspace_members WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL"),
        params![id, workspace_id],
        from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

fn validate_role(role: &str) -> AppResult<()> {
    // There is exactly one owner: the local user, created with the workspace.
    if matches!(role, "admin" | "member" | "viewer") { Ok(()) } else { Err(AppError::Validation("role")) }
}

fn validate_status(status: &str) -> AppResult<()> {
    if matches!(status, "active" | "inactive") { Ok(()) } else { Err(AppError::Validation("status")) }
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &MemberInput) -> AppResult<Member> {
    let tx = conn.transaction()?;
    let kind: String = tx
        .query_row("SELECT kind FROM workspaces WHERE id = ?1 AND deleted_at IS NULL", [workspace_id], |r| r.get(0))
        .optional()?
        .ok_or(AppError::NotFound)?;
    if kind != "family" {
        return Err(AppError::Conflict("members_only_in_family"));
    }
    let name = clean_required(&input.name, 60, "name")?;
    validate_role(&input.role)?;
    let id = new_id();
    let now = now_millis();
    tx.execute(
        "INSERT INTO workspace_members (id, workspace_id, name, role, status, joined_on, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?6)",
        params![id, workspace_id, name, input.role, format_date(today()), now],
    )?;
    let member = get(&tx, workspace_id, &id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "member",
            entity_id: &id,
            action: "create",
            version: member.version,
            old: None,
            new: Some(&member),
        },
    )?;
    tx.commit()?;
    Ok(member)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &MemberInput) -> AppResult<Member> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let name = clean_required(&input.name, 60, "name")?;
    let status = input.status.clone().unwrap_or_else(|| old.status.clone());
    validate_status(&status)?;
    let role = if old.role == "owner" {
        // The owner keeps the role and cannot be switched off.
        if input.role != "owner" || status != "active" {
            return Err(AppError::Conflict("owner_is_fixed"));
        }
        old.role.clone()
    } else {
        validate_role(&input.role)?;
        input.role.clone()
    };
    tx.execute(
        "UPDATE workspace_members SET name = ?1, role = ?2, status = ?3, updated_at = ?4, version = version + 1
         WHERE id = ?5",
        params![name, role, status, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "member",
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
