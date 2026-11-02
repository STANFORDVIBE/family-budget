//! Savings goals. A contribution only earmarks money; when it names an account it is backed by
//! a real transfer to the goal's storage account. Either way it is never an expense.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::transactions::{self, TransactionInput};
use super::{
    Change, Table, clean_color, clean_icon, clean_optional, clean_required, ensure_in_workspace, id_or_new, new_id,
    now_millis, record_change,
};
use crate::domain::dates::{format_date, parse_date, today};
use crate::domain::goal::{GoalProgress, progress};
use crate::domain::money;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub target: i64,
    pub currency: String,
    pub target_date: Option<String>,
    pub account_id: Option<String>,
    pub description: Option<String>,
    pub icon: String,
    pub color: String,
    pub status: String,
    pub progress: GoalProgress,
    pub created_at: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    pub id: Option<String>,
    pub name: String,
    pub target: i64,
    pub currency: String,
    pub target_date: Option<String>,
    pub account_id: Option<String>,
    pub description: Option<String>,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contribution {
    pub id: String,
    pub goal_id: String,
    pub amount: i64,
    pub date: String,
    pub transaction_id: Option<String>,
    pub comment: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributionInput {
    pub id: Option<String>,
    /// Positive: set aside; negative: taken back. In the goal currency.
    pub amount: i64,
    pub date: String,
    /// Account the money comes from (or returns to). Requires the goal to have a storage account.
    pub account_id: Option<String>,
    pub comment: Option<String>,
}

const SELECT: &str = "SELECT g.id, g.name, g.target_minor, g.currency, g.target_date, g.account_id, g.description,
        g.icon, g.color, g.status, g.created_at, g.version,
        COALESCE((SELECT SUM(c.amount_minor) FROM goal_contributions c WHERE c.goal_id = g.id AND c.deleted_at IS NULL), 0)
    FROM goals g";

fn from_row(r: &Row) -> rusqlite::Result<Goal> {
    let target: i64 = r.get(2)?;
    let target_date: Option<String> = r.get(4)?;
    let current: i64 = r.get(12)?;
    let date = target_date.as_deref().and_then(|d| parse_date(d, "target_date").ok());
    Ok(Goal {
        id: r.get(0)?,
        name: r.get(1)?,
        target,
        currency: r.get(3)?,
        target_date,
        account_id: r.get(5)?,
        description: r.get(6)?,
        icon: r.get(7)?,
        color: r.get(8)?,
        status: r.get(9)?,
        progress: progress(target, current, date, today()),
        created_at: r.get(10)?,
        version: r.get(11)?,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<Goal>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE g.workspace_id = ?1 AND g.deleted_at IS NULL
         ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'achieved' THEN 1 ELSE 2 END, g.created_at"
    ))?;
    let rows = stmt.query_map([workspace_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Goal> {
    conn.query_row(
        &format!("{SELECT} WHERE g.id = ?1 AND g.workspace_id = ?2 AND g.deleted_at IS NULL"),
        params![id, workspace_id],
        from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

struct Clean {
    name: String,
    target_date: Option<String>,
    account_id: Option<String>,
    description: Option<String>,
    icon: String,
    color: String,
}

fn validate(conn: &Connection, workspace_id: &str, input: &GoalInput) -> AppResult<Clean> {
    let name = clean_required(&input.name, 80, "name")?;
    money::require_positive(input.target, "target")?;
    super::currency_decimals(conn, &input.currency)?;
    let target_date =
        input.target_date.as_deref().filter(|d| !d.is_empty()).map(|d| parse_date(d, "target_date")).transpose()?;
    let account_id = match input.account_id.as_deref().filter(|a| !a.is_empty()) {
        Some(id) => {
            let currency: Option<String> = conn
                .query_row(
                    "SELECT currency FROM accounts WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
                    params![id, workspace_id],
                    |r| r.get(0),
                )
                .optional()?;
            // The storage account holds the goal's money, so it must be in the goal currency.
            if currency.as_deref() != Some(input.currency.as_str()) {
                return Err(AppError::Validation("account_id"));
            }
            Some(id.to_string())
        }
        None => None,
    };
    Ok(Clean {
        name,
        target_date: target_date.map(format_date),
        account_id,
        description: clean_optional(input.description.as_deref(), 500, "description")?,
        icon: clean_icon(&input.icon)?,
        color: clean_color(&input.color)?,
    })
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &GoalInput) -> AppResult<Goal> {
    let tx = conn.transaction()?;
    let id = id_or_new(input.id.as_deref())?;
    if let Ok(existing) = get(&tx, workspace_id, &id) {
        return Ok(existing);
    }
    let c = validate(&tx, workspace_id, input)?;
    let now = now_millis();
    tx.execute(
        "INSERT INTO goals (id, workspace_id, name, target_minor, currency, target_date, account_id, description,
                            icon, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            workspace_id,
            c.name,
            input.target,
            input.currency,
            c.target_date,
            c.account_id,
            c.description,
            c.icon,
            c.color,
            now
        ],
    )?;
    let goal = get(&tx, workspace_id, &id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "goal",
            entity_id: &id,
            action: "create",
            version: goal.version,
            old: None,
            new: Some(&goal),
        },
    )?;
    tx.commit()?;
    Ok(goal)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &GoalInput) -> AppResult<Goal> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let c = validate(&tx, workspace_id, input)?;
    let has_contributions: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM goal_contributions WHERE goal_id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if has_contributions && input.currency != old.currency {
        return Err(AppError::Conflict("goal_currency_has_history"));
    }
    tx.execute(
        "UPDATE goals SET name = ?1, target_minor = ?2, currency = ?3, target_date = ?4, account_id = ?5,
                description = ?6, icon = ?7, color = ?8, updated_at = ?9, version = version + 1
         WHERE id = ?10",
        params![
            c.name,
            input.target,
            input.currency,
            c.target_date,
            c.account_id,
            c.description,
            c.icon,
            c.color,
            now_millis(),
            id
        ],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "goal",
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

pub fn set_status(conn: &mut Connection, workspace_id: &str, id: &str, status: &str) -> AppResult<Goal> {
    if !matches!(status, "active" | "achieved" | "archived") {
        return Err(AppError::Validation("status"));
    }
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    tx.execute(
        "UPDATE goals SET status = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
        params![status, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "goal",
            entity_id: id,
            action: "set_status",
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

/// Deletes the goal and its earmarks. Real transfers made for it stay: that money did move.
pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let now = now_millis();
    tx.execute(
        "UPDATE goal_contributions SET deleted_at = ?1, updated_at = ?1, version = version + 1
         WHERE goal_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE goals SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    record_change(
        &tx,
        Change::<Goal> {
            workspace_id: Some(workspace_id),
            entity: "goal",
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

pub fn contributions(conn: &Connection, workspace_id: &str, goal_id: &str) -> AppResult<Vec<Contribution>> {
    ensure_in_workspace(conn, Table::Goals, goal_id, workspace_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, goal_id, amount_minor, contributed_on, transaction_id, comment, created_at
         FROM goal_contributions WHERE goal_id = ?1 AND deleted_at IS NULL
         ORDER BY contributed_on DESC, created_at DESC",
    )?;
    let rows = stmt
        .query_map([goal_id], |r| {
            Ok(Contribution {
                id: r.get(0)?,
                goal_id: r.get(1)?,
                amount: r.get(2)?,
                date: r.get(3)?,
                transaction_id: r.get(4)?,
                comment: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn contribute(
    conn: &mut Connection,
    workspace_id: &str,
    goal_id: &str,
    input: &ContributionInput,
) -> AppResult<Goal> {
    let tx = conn.transaction()?;
    let goal = get(&tx, workspace_id, goal_id)?;
    let id = id_or_new(input.id.as_deref())?;
    let exists: bool =
        tx.query_row("SELECT EXISTS (SELECT 1 FROM goal_contributions WHERE id = ?1)", [&id], |r| r.get(0))?;
    if exists {
        return get(&tx, workspace_id, goal_id);
    }
    if input.amount == 0 {
        return Err(AppError::Validation("amount"));
    }
    money::require_in_range(input.amount, "amount")?;
    let date = format_date(parse_date(&input.date, "date")?);
    if input.amount < 0 && -input.amount > goal.progress.current {
        return Err(AppError::Validation("amount"));
    }
    let comment = clean_optional(input.comment.as_deref(), 500, "comment")?;

    let transaction_id = match input.account_id.as_deref().filter(|a| !a.is_empty()) {
        Some(other) => {
            let storage = goal.account_id.as_deref().ok_or(AppError::Conflict("goal_without_account"))?;
            if other == storage {
                return Err(AppError::Validation("account_id"));
            }
            let other_currency: Option<String> = tx
                .query_row(
                    "SELECT currency FROM accounts WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
                    params![other, workspace_id],
                    |r| r.get(0),
                )
                .optional()?;
            if other_currency.as_deref() != Some(goal.currency.as_str()) {
                return Err(AppError::Validation("account_id"));
            }
            let (from, to) = if input.amount > 0 { (other, storage) } else { (storage, other) };
            let tx_id = new_id();
            transactions::insert(
                &tx,
                workspace_id,
                &tx_id,
                &TransactionInput {
                    kind: "transfer".into(),
                    date: date.clone(),
                    account_id: from.to_string(),
                    amount: input.amount.abs(),
                    to_account_id: Some(to.to_string()),
                    comment: Some(comment.clone().unwrap_or_else(|| goal.name.clone())),
                    ..Default::default()
                },
                false,
                None,
            )?;
            Some(tx_id)
        }
        None => None,
    };

    let now = now_millis();
    tx.execute(
        "INSERT INTO goal_contributions (id, goal_id, workspace_id, amount_minor, contributed_on, transaction_id,
                                         comment, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, goal_id, workspace_id, input.amount, date, transaction_id, comment, now],
    )?;
    let updated = get(&tx, workspace_id, goal_id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "goal_contribution",
            entity_id: &id,
            action: "create",
            version: 1,
            old: None,
            new: Some(
                &serde_json::json!({ "goalId": goal_id, "amount": input.amount, "date": date, "transactionId": transaction_id }),
            ),
        },
    )?;
    tx.commit()?;
    Ok(updated)
}

/// Removes a contribution; a transfer made with it is removed too, so money returns to its account.
pub fn delete_contribution(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let row: Option<(String, i64, Option<String>)> = tx
        .query_row(
            "SELECT goal_id, amount_minor, transaction_id FROM goal_contributions
             WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
            params![id, workspace_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (goal_id, amount, transaction_id) = row.ok_or(AppError::NotFound)?;
    let now = now_millis();
    tx.execute(
        "UPDATE goal_contributions SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    if let Some(tx_id) = &transaction_id {
        tx.execute(
            "UPDATE transactions SET deleted_at = ?1, updated_at = ?1, version = version + 1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![now, tx_id],
        )?;
        let version: i64 = tx.query_row("SELECT version FROM transactions WHERE id = ?1", [tx_id], |r| r.get(0))?;
        record_change(
            &tx,
            Change {
                workspace_id: Some(workspace_id),
                entity: "transaction",
                entity_id: tx_id,
                action: "delete",
                version,
                old: Some(&serde_json::json!({ "reason": "goal_contribution_deleted" })),
                new: None,
            },
        )?;
    }
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "goal_contribution",
            entity_id: id,
            action: "delete",
            version: 2,
            old: Some(&serde_json::json!({ "goalId": goal_id, "amount": amount, "transactionId": transaction_id })),
            new: None,
        },
    )?;
    tx.commit()?;
    Ok(())
}
