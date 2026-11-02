//! Reading the change journal.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub entity: String,
    pub entity_id: String,
    pub action: String,
    pub old_value: Option<serde_json::Value>,
    pub new_value: Option<serde_json::Value>,
    pub at: i64,
    pub user_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilter {
    pub entity_id: Option<String>,
    pub limit: Option<i64>,
}

pub fn list(conn: &Connection, workspace_id: &str, filter: &AuditFilter) -> AppResult<Vec<AuditEntry>> {
    let limit = filter.limit.unwrap_or(200).clamp(1, 1000);
    let mut stmt = conn.prepare(
        "SELECT l.id, l.entity, l.entity_id, l.action, l.old_value, l.new_value, l.at, u.name
         FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.workspace_id = ?1 AND (?2 IS NULL OR l.entity_id = ?2)
         ORDER BY l.at DESC, l.rowid DESC LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![workspace_id, filter.entity_id, limit], |r| {
            let old: Option<String> = r.get(4)?;
            let new: Option<String> = r.get(5)?;
            Ok(AuditEntry {
                id: r.get(0)?,
                entity: r.get(1)?,
                entity_id: r.get(2)?,
                action: r.get(3)?,
                old_value: old.and_then(|v| serde_json::from_str(&v).ok()),
                new_value: new.and_then(|v| serde_json::from_str(&v).ok()),
                at: r.get(6)?,
                user_name: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
