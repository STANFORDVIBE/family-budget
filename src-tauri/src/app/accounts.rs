//! Accounts and wallets. The current balance is never stored: it is the opening balance plus the
//! sum of posted ledger entries, so it always agrees with the operation history.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{
    Change, Table, clean_color, clean_icon, clean_required, ensure_in_workspace, id_or_new, now_millis, record_change,
};
use crate::domain::money;
use crate::error::{AppError, AppResult};

pub const KINDS: &[&str] = &["cash", "debit_card", "credit_card", "bank", "savings", "ewallet", "other"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub initial_balance: i64,
    pub balance: i64,
    pub credit_limit: Option<i64>,
    pub icon: String,
    pub color: String,
    pub is_active: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub version: i64,
    pub has_operations: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub initial_balance: i64,
    pub credit_limit: Option<i64>,
    pub icon: String,
    pub color: String,
}

/// Sum of posted entries of an account. Pending and deleted operations do not count.
pub const BALANCE_SQL: &str = "a.initial_balance_minor + COALESCE((
    SELECT SUM(e.amount_minor) FROM transaction_entries e
    JOIN transactions t ON t.id = e.transaction_id
    WHERE e.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'posted'), 0)";

fn select_sql(filter: &str) -> String {
    format!(
        "SELECT a.id, a.workspace_id, a.name, a.kind, a.currency, a.initial_balance_minor, {BALANCE_SQL},
                a.credit_limit_minor, a.icon, a.color, a.is_active, a.sort_order, a.created_at, a.version,
                EXISTS (SELECT 1 FROM transaction_entries e WHERE e.account_id = a.id)
         FROM accounts a WHERE a.deleted_at IS NULL AND {filter}
         ORDER BY a.is_active DESC, a.sort_order, a.created_at"
    )
}

fn from_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        currency: r.get(4)?,
        initial_balance: r.get(5)?,
        balance: r.get(6)?,
        credit_limit: r.get(7)?,
        icon: r.get(8)?,
        color: r.get(9)?,
        is_active: r.get(10)?,
        sort_order: r.get(11)?,
        created_at: r.get(12)?,
        version: r.get(13)?,
        has_operations: r.get(14)?,
    })
}

pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&select_sql("a.workspace_id = ?1"))?;
    let rows = stmt.query_map([workspace_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Account> {
    conn.query_row(&select_sql("a.workspace_id = ?1 AND a.id = ?2"), params![workspace_id, id], from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

struct Clean {
    name: String,
    credit_limit: Option<i64>,
    icon: String,
    color: String,
}

fn validate(conn: &Connection, input: &AccountInput) -> AppResult<Clean> {
    let name = clean_required(&input.name, 60, "name")?;
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Validation("kind"));
    }
    super::currency_decimals(conn, &input.currency)?;
    money::require_in_range(input.initial_balance, "initial_balance")?;
    // A credit limit is the bank's money: it is stored only to show available credit.
    let credit_limit = if input.kind == "credit_card" {
        match input.credit_limit {
            Some(limit) if !(0..=money::MAX_AMOUNT).contains(&limit) => {
                return Err(AppError::Validation("credit_limit"));
            }
            other => other,
        }
    } else {
        None
    };
    Ok(Clean { name, credit_limit, icon: clean_icon(&input.icon)?, color: clean_color(&input.color)? })
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &AccountInput) -> AppResult<Account> {
    let tx = conn.transaction()?;
    let id = id_or_new(input.id.as_deref())?;
    // Idempotent: a repeated create with the same id (double click, retry) returns the first result.
    if let Ok(existing) = get(&tx, workspace_id, &id) {
        return Ok(existing);
    }
    let clean = validate(&tx, input)?;
    let now = now_millis();
    let order: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM accounts WHERE workspace_id = ?1",
        [workspace_id],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO accounts (id, workspace_id, name, kind, currency, initial_balance_minor, credit_limit_minor,
                               icon, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            workspace_id,
            clean.name,
            input.kind,
            input.currency,
            input.initial_balance,
            clean.credit_limit,
            clean.icon,
            clean.color,
            order,
            now
        ],
    )?;
    let account = get(&tx, workspace_id, &id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "account",
            entity_id: &id,
            action: "create",
            version: account.version,
            old: None,
            new: Some(&account),
        },
    )?;
    tx.commit()?;
    Ok(account)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &AccountInput) -> AppResult<Account> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let clean = validate(&tx, input)?;
    // Entries are stored in the account currency; changing it would reinterpret history.
    if input.currency != old.currency && old.has_operations {
        return Err(AppError::Conflict("account_currency_has_history"));
    }
    tx.execute(
        "UPDATE accounts SET name = ?1, kind = ?2, currency = ?3, initial_balance_minor = ?4, credit_limit_minor = ?5,
                icon = ?6, color = ?7, updated_at = ?8, version = version + 1
         WHERE id = ?9",
        params![
            clean.name,
            input.kind,
            input.currency,
            input.initial_balance,
            clean.credit_limit,
            clean.icon,
            clean.color,
            now_millis(),
            id
        ],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "account",
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

/// Archives or re-activates an account. Archived accounts keep their history and balance.
pub fn set_active(conn: &mut Connection, workspace_id: &str, id: &str, active: bool) -> AppResult<Account> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    tx.execute(
        "UPDATE accounts SET is_active = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
        params![active, now_millis(), id],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "account",
            entity_id: id,
            action: if active { "activate" } else { "archive" },
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

/// Deletes an account that was never used. Accounts with history can only be archived.
pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    ensure_in_workspace(&tx, Table::Accounts, id, workspace_id)?;
    let old = get(&tx, workspace_id, id)?;
    let referenced: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM transaction_entries WHERE account_id = ?1)
             OR EXISTS (SELECT 1 FROM recurring_rules WHERE account_id = ?1 AND deleted_at IS NULL)
             OR EXISTS (SELECT 1 FROM goals WHERE account_id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if referenced {
        return Err(AppError::Conflict("account_in_use"));
    }
    tx.execute(
        "UPDATE accounts SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now_millis(), id],
    )?;
    record_change(
        &tx,
        Change::<Account> {
            workspace_id: Some(workspace_id),
            entity: "account",
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
