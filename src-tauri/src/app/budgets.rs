//! Monthly budgets: an overall limit and per-category limits, compared with actual spending.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::analytics::spending_by_category;
use super::{Change, Table, ensure_in_workspace, new_id, now_millis, record_change, workspace_base};
use crate::domain::budget::{LimitStatus, forecast_month, limit_status};
use crate::domain::dates::{format_date, format_month, month_end, parse_month, prev_month, today};
use crate::domain::money;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitView {
    pub id: String,
    pub category_id: String,
    pub limit: i64,
    pub spent: i64,
    pub remaining: i64,
    pub percent_bp: i64,
    pub status: LimitStatus,
    pub forecast: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetView {
    pub month: String,
    pub currency: String,
    pub budget_id: Option<String>,
    pub total_limit: Option<i64>,
    pub total_spent: i64,
    pub total_remaining: Option<i64>,
    pub total_percent_bp: Option<i64>,
    pub total_status: Option<LimitStatus>,
    pub total_forecast: i64,
    pub limits: Vec<LimitView>,
    /// Spending in categories without their own limit (and transfer fees).
    pub unbudgeted_spent: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitInput {
    pub category_id: String,
    pub limit: i64,
}

fn budget_id(conn: &Connection, workspace_id: &str, month: &str) -> AppResult<Option<(String, Option<i64>, i64)>> {
    Ok(conn
        .query_row(
            "SELECT id, total_limit_minor, version FROM budgets WHERE workspace_id = ?1 AND month = ?2 AND deleted_at IS NULL",
            params![workspace_id, month],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?)
}

fn ensure_budget(conn: &Connection, workspace_id: &str, month: &str) -> AppResult<String> {
    if let Some((id, _, _)) = budget_id(conn, workspace_id, month)? {
        return Ok(id);
    }
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO budgets (id, workspace_id, month, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, workspace_id, month, now],
    )?;
    record_change(
        conn,
        Change {
            workspace_id: Some(workspace_id),
            entity: "budget",
            entity_id: &id,
            action: "create",
            version: 1,
            old: None,
            new: Some(&serde_json::json!({ "month": month })),
        },
    )?;
    Ok(id)
}

fn normalize_month(month: &str) -> AppResult<String> {
    Ok(format_month(parse_month(month)?))
}

pub fn get(conn: &Connection, workspace_id: &str, month: &str) -> AppResult<BudgetView> {
    let month = normalize_month(month)?;
    let start = parse_month(&month)?;
    let base = workspace_base(conn, workspace_id)?;
    let spending = spending_by_category(conn, workspace_id, &format_date(start), &format_date(month_end(start)))?;
    let total_spent = money::sum(spending.values().copied())?;

    // Parent of each subcategory, to roll child spending into the parent's limit.
    let parents: HashMap<String, Option<String>> = conn
        .prepare("SELECT id, parent_id FROM categories WHERE workspace_id = ?1")?
        .query_map([workspace_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let today = today();
    let budget = budget_id(conn, workspace_id, &month)?;
    let mut limits = Vec::new();
    let mut covered = 0_i64;
    if let Some((id, _, _)) = &budget {
        let rows: Vec<(String, String, i64)> = conn
            .prepare(
                "SELECT l.id, l.category_id, l.limit_minor FROM budget_limits l
                 JOIN categories c ON c.id = l.category_id
                 WHERE l.budget_id = ?1 AND l.deleted_at IS NULL
                 ORDER BY c.sort_order",
            )?
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        let limited: Vec<&String> = rows.iter().map(|(_, c, _)| c).collect();
        for (limit_id, category_id, limit) in &rows {
            let spent = money::sum(spending.iter().filter_map(|(cat, value)| {
                let cat = cat.as_ref()?;
                let own = cat == category_id;
                // A child counts towards its parent's limit unless it has a limit of its own.
                let via_parent =
                    parents.get(cat).and_then(|p| p.as_ref()) == Some(category_id) && !limited.contains(&cat);
                (own || via_parent).then_some(*value)
            }))?;
            covered += spent;
            limits.push(LimitView {
                id: limit_id.clone(),
                category_id: category_id.clone(),
                limit: *limit,
                spent,
                remaining: limit - spent,
                percent_bp: money::basis_points(spent, *limit),
                status: limit_status(spent, *limit),
                forecast: forecast_month(spent, start, today),
            });
        }
    }
    let total_limit = budget.as_ref().and_then(|(_, total, _)| *total);
    Ok(BudgetView {
        month,
        currency: base.code,
        budget_id: budget.map(|(id, _, _)| id),
        total_limit,
        total_spent,
        total_remaining: total_limit.map(|l| l - total_spent),
        total_percent_bp: total_limit.map(|l| money::basis_points(total_spent, l)),
        total_status: total_limit.map(|l| limit_status(total_spent, l)),
        total_forecast: forecast_month(total_spent, start, today),
        limits,
        unbudgeted_spent: total_spent - covered,
    })
}

pub fn set_total(conn: &mut Connection, workspace_id: &str, month: &str, limit: Option<i64>) -> AppResult<BudgetView> {
    let month = normalize_month(month)?;
    if limit.is_some_and(|l| !(0..=money::MAX_AMOUNT).contains(&l)) {
        return Err(AppError::Validation("limit"));
    }
    let tx = conn.transaction()?;
    let id = ensure_budget(&tx, workspace_id, &month)?;
    let old: Option<i64> = tx.query_row("SELECT total_limit_minor FROM budgets WHERE id = ?1", [&id], |r| r.get(0))?;
    tx.execute(
        "UPDATE budgets SET total_limit_minor = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
        params![limit, now_millis(), id],
    )?;
    let version: i64 = tx.query_row("SELECT version FROM budgets WHERE id = ?1", [&id], |r| r.get(0))?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "budget",
            entity_id: &id,
            action: "set_total",
            version,
            old: Some(&serde_json::json!({ "month": month, "totalLimit": old })),
            new: Some(&serde_json::json!({ "month": month, "totalLimit": limit })),
        },
    )?;
    tx.commit()?;
    get(conn, workspace_id, &month)
}

fn upsert_limit(
    conn: &Connection,
    workspace_id: &str,
    budget_id: &str,
    category_id: &str,
    limit: i64,
) -> AppResult<()> {
    let existing: Option<(String, i64, i64)> = conn
        .query_row(
            "SELECT id, limit_minor, version FROM budget_limits WHERE budget_id = ?1 AND category_id = ?2 AND deleted_at IS NULL",
            params![budget_id, category_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let now = now_millis();
    let (id, old, version) = match existing {
        Some((id, old, version)) => {
            conn.execute(
                "UPDATE budget_limits SET limit_minor = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
                params![limit, now, id],
            )?;
            (id, Some(old), version + 1)
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO budget_limits (id, budget_id, workspace_id, category_id, limit_minor, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, budget_id, workspace_id, category_id, limit, now],
            )?;
            (id, None, 1)
        }
    };
    record_change(
        conn,
        Change {
            workspace_id: Some(workspace_id),
            entity: "budget_limit",
            entity_id: &id,
            action: if old.is_some() { "update" } else { "create" },
            version,
            old: old.map(|o| serde_json::json!({ "categoryId": category_id, "limit": o })).as_ref(),
            new: Some(&serde_json::json!({ "categoryId": category_id, "limit": limit })),
        },
    )?;
    Ok(())
}

pub fn set_limit(conn: &mut Connection, workspace_id: &str, month: &str, input: &LimitInput) -> AppResult<BudgetView> {
    let month = normalize_month(month)?;
    if !(0..=money::MAX_AMOUNT).contains(&input.limit) {
        return Err(AppError::Validation("limit"));
    }
    let tx = conn.transaction()?;
    let kind: Option<String> = tx
        .query_row(
            "SELECT kind FROM categories WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
            params![input.category_id, workspace_id],
            |r| r.get(0),
        )
        .optional()?;
    if kind.as_deref() != Some("expense") {
        return Err(AppError::Validation("category_id"));
    }
    let id = ensure_budget(&tx, workspace_id, &month)?;
    upsert_limit(&tx, workspace_id, &id, &input.category_id, input.limit)?;
    tx.commit()?;
    get(conn, workspace_id, &month)
}

pub fn remove_limit(
    conn: &mut Connection,
    workspace_id: &str,
    month: &str,
    category_id: &str,
) -> AppResult<BudgetView> {
    let month = normalize_month(month)?;
    let tx = conn.transaction()?;
    if let Some((budget, _, _)) = budget_id(&tx, workspace_id, &month)? {
        ensure_in_workspace(&tx, Table::Budgets, &budget, workspace_id)?;
        let row: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT id, limit_minor, version FROM budget_limits WHERE budget_id = ?1 AND category_id = ?2 AND deleted_at IS NULL",
                params![budget, category_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((id, limit, version)) = row {
            tx.execute(
                "UPDATE budget_limits SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
                params![now_millis(), id],
            )?;
            record_change(
                &tx,
                Change {
                    workspace_id: Some(workspace_id),
                    entity: "budget_limit",
                    entity_id: &id,
                    action: "delete",
                    version: version + 1,
                    old: Some(&serde_json::json!({ "categoryId": category_id, "limit": limit })),
                    new: None,
                },
            )?;
        }
    }
    tx.commit()?;
    get(conn, workspace_id, &month)
}

/// Copies the previous month's total and category limits into an empty month.
pub fn copy_previous(conn: &mut Connection, workspace_id: &str, month: &str) -> AppResult<BudgetView> {
    let month = normalize_month(month)?;
    let previous = format_month(prev_month(parse_month(&month)?));
    let tx = conn.transaction()?;
    let Some((prev_id, prev_total, _)) = budget_id(&tx, workspace_id, &previous)? else {
        return Err(AppError::Conflict("previous_budget_empty"));
    };
    let prev_limits: Vec<(String, i64)> = tx
        .prepare(
            "SELECT l.category_id, l.limit_minor FROM budget_limits l JOIN categories c ON c.id = l.category_id
             WHERE l.budget_id = ?1 AND l.deleted_at IS NULL AND c.deleted_at IS NULL",
        )?
        .query_map([&prev_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    if prev_total.is_none() && prev_limits.is_empty() {
        return Err(AppError::Conflict("previous_budget_empty"));
    }
    if let Some((current, total, _)) = budget_id(&tx, workspace_id, &month)? {
        let has_limits: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM budget_limits WHERE budget_id = ?1 AND deleted_at IS NULL)",
            [&current],
            |r| r.get(0),
        )?;
        if has_limits || total.is_some() {
            return Err(AppError::Conflict("budget_not_empty"));
        }
    }
    let id = ensure_budget(&tx, workspace_id, &month)?;
    tx.execute(
        "UPDATE budgets SET total_limit_minor = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
        params![prev_total, now_millis(), id],
    )?;
    for (category_id, limit) in &prev_limits {
        upsert_limit(&tx, workspace_id, &id, category_id, *limit)?;
    }
    tx.commit()?;
    get(conn, workspace_id, &month)
}
