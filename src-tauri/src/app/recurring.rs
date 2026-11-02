//! Recurring payments. Nothing is ever charged automatically: each due occurrence becomes a
//! pending operation that the user confirms (or skips). The unique index on
//! (recurring_rule_id, recurring_occurrence) guarantees one occurrence → at most one operation.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::transactions::{self, TransactionInput};
use super::{
    Change, Table, clean_optional, clean_required, ensure_in_workspace, id_or_new, new_id, now_millis, record_change,
};
use crate::domain::dates::{Date, add_days, format_date, parse_date, today};
use crate::domain::money;
use crate::domain::recurring::{IntervalUnit, Schedule};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRule {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub amount: i64,
    pub currency: String,
    pub account_id: String,
    pub category_id: String,
    pub member_id: Option<String>,
    pub comment: Option<String>,
    pub interval_unit: String,
    pub interval_count: u32,
    pub start_date: String,
    pub next_date: String,
    pub end_date: Option<String>,
    pub status: String,
    pub pending_count: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub amount: i64,
    pub account_id: String,
    pub category_id: String,
    pub member_id: Option<String>,
    pub comment: Option<String>,
    pub interval_unit: String,
    pub interval_count: u32,
    pub start_date: String,
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationReport {
    pub created: i64,
    /// Rules that could not produce their operation (e.g. the account was archived).
    pub failed_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upcoming {
    pub rule_id: String,
    pub name: String,
    pub kind: String,
    pub amount: i64,
    pub currency: String,
    pub date: String,
}

const SELECT: &str = "SELECT r.id, r.name, r.kind, r.amount_minor, a.currency, r.account_id, r.category_id, r.member_id,
        r.comment, r.interval_unit, r.interval_count, r.start_date, r.next_date, r.end_date, r.status,
        (SELECT COUNT(*) FROM transactions t WHERE t.recurring_rule_id = r.id AND t.status = 'pending' AND t.deleted_at IS NULL),
        r.version
    FROM recurring_rules r JOIN accounts a ON a.id = r.account_id";

fn from_row(r: &Row) -> rusqlite::Result<RecurringRule> {
    Ok(RecurringRule {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        amount: r.get(3)?,
        currency: r.get(4)?,
        account_id: r.get(5)?,
        category_id: r.get(6)?,
        member_id: r.get(7)?,
        comment: r.get(8)?,
        interval_unit: r.get(9)?,
        interval_count: r.get(10)?,
        start_date: r.get(11)?,
        next_date: r.get(12)?,
        end_date: r.get(13)?,
        status: r.get(14)?,
        pending_count: r.get(15)?,
        version: r.get(16)?,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<RecurringRule>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE r.workspace_id = ?1 AND r.deleted_at IS NULL
         ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, r.next_date"
    ))?;
    let rows = stmt.query_map([workspace_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<RecurringRule> {
    conn.query_row(
        &format!("{SELECT} WHERE r.id = ?1 AND r.workspace_id = ?2 AND r.deleted_at IS NULL"),
        params![id, workspace_id],
        from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

fn schedule_of(rule: &RecurringRule) -> AppResult<Schedule> {
    Schedule::new(
        parse_date(&rule.start_date, "start_date")?,
        IntervalUnit::parse(&rule.interval_unit)?,
        rule.interval_count,
        rule.end_date.as_deref().map(|d| parse_date(d, "end_date")).transpose()?,
    )
}

struct Clean {
    name: String,
    comment: Option<String>,
    schedule: Schedule,
}

fn validate(conn: &Connection, workspace_id: &str, input: &RecurringInput) -> AppResult<Clean> {
    let name = clean_required(&input.name, 80, "name")?;
    if !matches!(input.kind.as_str(), "expense" | "income") {
        return Err(AppError::Validation("kind"));
    }
    money::require_positive(input.amount, "amount")?;
    ensure_in_workspace(conn, Table::Accounts, &input.account_id, workspace_id)
        .map_err(|_| AppError::Validation("account_id"))?;
    let cat_kind: Option<String> = conn
        .query_row(
            "SELECT kind FROM categories WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
            params![input.category_id, workspace_id],
            |r| r.get(0),
        )
        .optional()?;
    if cat_kind.as_deref() != Some(input.kind.as_str()) {
        return Err(AppError::Validation("category_id"));
    }
    if let Some(member) = input.member_id.as_deref().filter(|m| !m.is_empty()) {
        ensure_in_workspace(conn, Table::Members, member, workspace_id)
            .map_err(|_| AppError::Validation("member_id"))?;
    }
    let schedule = Schedule::new(
        parse_date(&input.start_date, "start_date")?,
        IntervalUnit::parse(&input.interval_unit)?,
        input.interval_count,
        input.end_date.as_deref().filter(|d| !d.is_empty()).map(|d| parse_date(d, "end_date")).transpose()?,
    )?;
    Ok(Clean { name, comment: clean_optional(input.comment.as_deref(), 500, "comment")?, schedule })
}

/// Next occurrence that has not produced an operation yet.
fn next_open(conn: &Connection, rule_id: &str, schedule: &Schedule) -> AppResult<Option<Date>> {
    let last: Option<String> = conn.query_row(
        "SELECT MAX(recurring_occurrence) FROM transactions WHERE recurring_rule_id = ?1",
        [rule_id],
        |r| r.get(0),
    )?;
    Ok(match last {
        Some(last) => schedule.first_after(parse_date(&last, "date")?),
        None => schedule.first_on_or_after(schedule.start),
    })
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &RecurringInput) -> AppResult<RecurringRule> {
    let tx = conn.transaction()?;
    let id = id_or_new(input.id.as_deref())?;
    if let Ok(existing) = get(&tx, workspace_id, &id) {
        return Ok(existing);
    }
    let clean = validate(&tx, workspace_id, input)?;
    let now = now_millis();
    tx.execute(
        "INSERT INTO recurring_rules (id, workspace_id, name, kind, amount_minor, account_id, category_id, member_id,
                                      comment, interval_unit, interval_count, start_date, next_date, end_date,
                                      created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?14, ?14)",
        params![
            id,
            workspace_id,
            clean.name,
            input.kind,
            input.amount,
            input.account_id,
            input.category_id,
            input.member_id.as_deref().filter(|m| !m.is_empty()),
            clean.comment,
            clean.schedule.unit.as_str(),
            clean.schedule.count,
            format_date(clean.schedule.start),
            clean.schedule.end.map(format_date),
            now
        ],
    )?;
    let rule = get(&tx, workspace_id, &id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "recurring",
            entity_id: &id,
            action: "create",
            version: rule.version,
            old: None,
            new: Some(&rule),
        },
    )?;
    tx.commit()?;
    Ok(rule)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &RecurringInput) -> AppResult<RecurringRule> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let clean = validate(&tx, workspace_id, input)?;
    let next = next_open(&tx, id, &clean.schedule)?;
    let status = match (&next, old.status.as_str()) {
        (None, _) => "finished",
        (Some(_), "finished") => "active",
        (Some(_), s) => s,
    };
    tx.execute(
        "UPDATE recurring_rules SET name = ?1, kind = ?2, amount_minor = ?3, account_id = ?4, category_id = ?5,
                member_id = ?6, comment = ?7, interval_unit = ?8, interval_count = ?9, start_date = ?10,
                next_date = ?11, end_date = ?12, status = ?13, updated_at = ?14, version = version + 1
         WHERE id = ?15",
        params![
            clean.name,
            input.kind,
            input.amount,
            input.account_id,
            input.category_id,
            input.member_id.as_deref().filter(|m| !m.is_empty()),
            clean.comment,
            clean.schedule.unit.as_str(),
            clean.schedule.count,
            format_date(clean.schedule.start),
            format_date(next.unwrap_or(clean.schedule.start)),
            clean.schedule.end.map(format_date),
            status,
            now_millis(),
            id
        ],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "recurring",
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

/// Pauses or resumes a rule. A resumed rule continues from today: paused periods are not billed.
pub fn set_paused(conn: &mut Connection, workspace_id: &str, id: &str, paused: bool) -> AppResult<RecurringRule> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    if old.status == "finished" {
        return Err(AppError::Conflict("rule_finished"));
    }
    let schedule = schedule_of(&old)?;
    let (status, next) = if paused {
        ("paused", old.next_date.clone())
    } else {
        let after_last = next_open(&tx, id, &schedule)?;
        let from_today = schedule.first_on_or_after(today());
        match after_last.max(from_today) {
            Some(date) => ("active", format_date(date)),
            None => ("finished", old.next_date.clone()),
        }
    };
    tx.execute(
        "UPDATE recurring_rules SET status = ?1, next_date = ?2, updated_at = ?3, version = version + 1 WHERE id = ?4",
        params![status, next, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "recurring",
            entity_id: id,
            action: if paused { "pause" } else { "resume" },
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

/// Deletes a rule and its unconfirmed operations. Confirmed ones stay in history.
pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let now = now_millis();
    tx.execute(
        "UPDATE transactions SET deleted_at = ?1, updated_at = ?1, version = version + 1
         WHERE recurring_rule_id = ?2 AND status = 'pending' AND deleted_at IS NULL",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE recurring_rules SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    record_change(
        &tx,
        Change::<RecurringRule> {
            workspace_id: Some(workspace_id),
            entity: "recurring",
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

/// Creates pending operations for every due occurrence up to `until` (normally today).
/// Safe to call any number of times.
pub fn generate_due(conn: &mut Connection, workspace_id: &str, until: Date) -> AppResult<GenerationReport> {
    let rules: Vec<RecurringRule> = list(conn, workspace_id)?
        .into_iter()
        .filter(|r| r.status == "active" && r.next_date.as_str() <= format_date(until).as_str())
        .collect();
    let mut report = GenerationReport { created: 0, failed_rules: Vec::new() };
    for rule in rules {
        // One rule per transaction: a broken rule does not block the others.
        let tx = conn.transaction()?;
        match generate_rule(&tx, workspace_id, &rule, until) {
            Ok(created) => {
                tx.commit()?;
                report.created += created;
            }
            Err(AppError::Database(e)) => return Err(AppError::Database(e)),
            Err(_) => {
                drop(tx);
                report.failed_rules.push(rule.id.clone());
            }
        }
    }
    Ok(report)
}

fn generate_rule(conn: &Connection, workspace_id: &str, rule: &RecurringRule, until: Date) -> AppResult<i64> {
    let schedule = schedule_of(rule)?;
    let from = parse_date(&rule.next_date, "next_date")?;
    let mut created = 0;
    let mut last = None;
    for date in schedule.due(from, until) {
        let occurrence = format_date(date);
        last = Some(date);
        let exists: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM transactions WHERE recurring_rule_id = ?1 AND recurring_occurrence = ?2)",
            params![rule.id, occurrence],
            |r| r.get(0),
        )?;
        if exists {
            continue;
        }
        let input = TransactionInput {
            kind: rule.kind.clone(),
            date: occurrence.clone(),
            account_id: rule.account_id.clone(),
            amount: rule.amount,
            category_id: Some(rule.category_id.clone()),
            member_id: rule.member_id.clone(),
            comment: Some(rule.comment.clone().unwrap_or_else(|| rule.name.clone())),
            ..Default::default()
        };
        transactions::insert(conn, workspace_id, &new_id(), &input, true, Some((&rule.id, &occurrence)))?;
        created += 1;
    }
    let next = match last {
        Some(date) => schedule.first_after(date),
        None => schedule.first_on_or_after(from),
    };
    let (status, next_date) = match next {
        Some(date) => ("active", format_date(date)),
        None => ("finished", rule.next_date.clone()),
    };
    conn.execute(
        "UPDATE recurring_rules SET next_date = ?1, status = ?2, updated_at = ?3, version = version + 1 WHERE id = ?4",
        params![next_date, status, now_millis(), rule.id],
    )?;
    Ok(created)
}

/// Active rules' occurrences within the next `days` days (not yet turned into operations).
pub fn upcoming(conn: &Connection, workspace_id: &str, days: i64) -> AppResult<Vec<Upcoming>> {
    let today = today();
    let until = add_days(today, days);
    let mut result = Vec::new();
    for rule in list(conn, workspace_id)?.into_iter().filter(|r| r.status == "active") {
        let schedule = schedule_of(&rule)?;
        let from = parse_date(&rule.next_date, "next_date")?.max(today);
        for date in schedule.due(from, until).into_iter().take(10) {
            result.push(Upcoming {
                rule_id: rule.id.clone(),
                name: rule.name.clone(),
                kind: rule.kind.clone(),
                amount: rule.amount,
                currency: rule.currency.clone(),
                date: format_date(date),
            });
        }
    }
    result.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(result)
}
