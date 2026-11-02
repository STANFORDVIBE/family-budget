//! Income and expense categories with one level of subcategories.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Change, clean_color, clean_icon, clean_required, id_or_new, now_millis, record_change};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub is_hidden: bool,
    pub sort_order: i64,
    /// Operations, recurring payments and budget limits that point at this category.
    pub usage_count: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub icon: String,
    pub color: String,
}

fn select_sql(filter: &str) -> String {
    format!(
        "SELECT c.id, c.parent_id, c.kind, c.name, c.icon, c.color, c.is_hidden, c.sort_order,
                (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL)
              + (SELECT COUNT(*) FROM recurring_rules r WHERE r.category_id = c.id AND r.deleted_at IS NULL)
              + (SELECT COUNT(*) FROM budget_limits l WHERE l.category_id = c.id AND l.deleted_at IS NULL),
                c.version
         FROM categories c WHERE c.deleted_at IS NULL AND {filter}
         ORDER BY c.kind, c.sort_order, c.name"
    )
}

fn from_row(r: &Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        kind: r.get(2)?,
        name: r.get(3)?,
        icon: r.get(4)?,
        color: r.get(5)?,
        is_hidden: r.get(6)?,
        sort_order: r.get(7)?,
        usage_count: r.get(8)?,
        version: r.get(9)?,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(&select_sql("c.workspace_id = ?1"))?;
    let rows = stmt.query_map([workspace_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Category> {
    conn.query_row(&select_sql("c.workspace_id = ?1 AND c.id = ?2"), params![workspace_id, id], from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

/// A parent must be a top-level category of the same kind in the same workspace.
fn check_parent(conn: &Connection, workspace_id: &str, parent_id: &str, kind: &str, self_id: &str) -> AppResult<()> {
    if parent_id == self_id {
        return Err(AppError::Validation("parent_id"));
    }
    let parent = get(conn, workspace_id, parent_id).map_err(|_| AppError::Validation("parent_id"))?;
    if parent.kind != kind || parent.parent_id.is_some() {
        return Err(AppError::Validation("parent_id"));
    }
    Ok(())
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &CategoryInput) -> AppResult<Category> {
    let tx = conn.transaction()?;
    let id = id_or_new(input.id.as_deref())?;
    if let Ok(existing) = get(&tx, workspace_id, &id) {
        return Ok(existing);
    }
    let name = clean_required(&input.name, 60, "name")?;
    if !matches!(input.kind.as_str(), "expense" | "income") {
        return Err(AppError::Validation("kind"));
    }
    if let Some(parent) = &input.parent_id {
        check_parent(&tx, workspace_id, parent, &input.kind, &id)?;
    }
    let now = now_millis();
    let order: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE workspace_id = ?1 AND kind = ?2",
        params![workspace_id, input.kind],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO categories (id, workspace_id, parent_id, kind, name, icon, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id, workspace_id, input.parent_id, input.kind, name, clean_icon(&input.icon)?, clean_color(&input.color)?,
            order, now
        ],
    )?;
    let category = get(&tx, workspace_id, &id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "category",
            entity_id: &id,
            action: "create",
            version: category.version,
            old: None,
            new: Some(&category),
        },
    )?;
    tx.commit()?;
    Ok(category)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &CategoryInput) -> AppResult<Category> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let name = clean_required(&input.name, 60, "name")?;
    if input.kind != old.kind {
        return Err(AppError::Validation("kind"));
    }
    if let Some(parent) = &input.parent_id {
        check_parent(&tx, workspace_id, parent, &old.kind, id)?;
        let has_children: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM categories WHERE parent_id = ?1 AND deleted_at IS NULL)",
            [id],
            |r| r.get(0),
        )?;
        if has_children {
            return Err(AppError::Conflict("category_has_children"));
        }
    }
    tx.execute(
        "UPDATE categories SET name = ?1, parent_id = ?2, icon = ?3, color = ?4, updated_at = ?5, version = version + 1
         WHERE id = ?6",
        params![name, input.parent_id, clean_icon(&input.icon)?, clean_color(&input.color)?, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "category",
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

pub fn set_hidden(conn: &mut Connection, workspace_id: &str, id: &str, hidden: bool) -> AppResult<Category> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    tx.execute(
        "UPDATE categories SET is_hidden = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3 OR parent_id = ?3",
        params![hidden, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "category",
            entity_id: id,
            action: if hidden { "hide" } else { "show" },
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

/// Deletes a category. If history still uses it, everything is first moved to `reassign_to`
/// (a category of the same kind), so no operation loses its category.
pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str, reassign_to: Option<&str>) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let has_children: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM categories WHERE parent_id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if has_children {
        return Err(AppError::Conflict("category_has_children"));
    }
    // Soft-deleted operations still point at the category and may be restored.
    let used_anywhere: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM transactions WHERE category_id = ?1)
             OR EXISTS (SELECT 1 FROM recurring_rules WHERE category_id = ?1 AND deleted_at IS NULL)
             OR EXISTS (SELECT 1 FROM budget_limits WHERE category_id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    let now = now_millis();
    if used_anywhere {
        let target_id = reassign_to.ok_or(AppError::Conflict("category_in_use"))?;
        if target_id == id {
            return Err(AppError::Validation("reassign_to"));
        }
        let target = get(&tx, workspace_id, target_id).map_err(|_| AppError::Validation("reassign_to"))?;
        if target.kind != old.kind {
            return Err(AppError::Validation("reassign_to"));
        }
        reassign(&tx, workspace_id, id, target_id, now)?;
    }
    tx.execute(
        "UPDATE categories SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    record_change(
        &tx,
        Change::<Category> {
            workspace_id: Some(workspace_id),
            entity: "category",
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

fn reassign(conn: &Connection, workspace_id: &str, from: &str, to: &str, now: i64) -> AppResult<()> {
    for (table, entity) in [("transactions", "transaction"), ("recurring_rules", "recurring")] {
        let ids: Vec<(String, i64)> = conn
            .prepare(&format!("SELECT id, version FROM {table} WHERE category_id = ?1"))?
            .query_map([from], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (row_id, version) in ids {
            conn.execute(
                &format!("UPDATE {table} SET category_id = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3"),
                params![to, now, row_id],
            )?;
            record_change(
                conn,
                Change {
                    workspace_id: Some(workspace_id),
                    entity,
                    entity_id: &row_id,
                    action: "reassign_category",
                    version: version + 1,
                    old: Some(&serde_json::json!({ "categoryId": from })),
                    new: Some(&serde_json::json!({ "categoryId": to })),
                },
            )?;
        }
    }
    // Budget limits: move to the target, or add up into the target's limit for the same month.
    let limits: Vec<(String, String, i64)> = conn
        .prepare("SELECT id, budget_id, limit_minor FROM budget_limits WHERE category_id = ?1 AND deleted_at IS NULL")?
        .query_map([from], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (limit_id, budget_id, amount) in limits {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM budget_limits WHERE budget_id = ?1 AND category_id = ?2 AND deleted_at IS NULL",
                params![budget_id, to],
                |r| r.get(0),
            )
            .optional()?;
        match existing {
            Some(target_limit) => {
                conn.execute(
                    "UPDATE budget_limits SET limit_minor = limit_minor + ?1, updated_at = ?2, version = version + 1
                     WHERE id = ?3",
                    params![amount, now, target_limit],
                )?;
                conn.execute(
                    "UPDATE budget_limits SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
                    params![now, limit_id],
                )?;
            }
            None => {
                conn.execute(
                    "UPDATE budget_limits SET category_id = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
                    params![to, now, limit_id],
                )?;
            }
        }
    }
    Ok(())
}
