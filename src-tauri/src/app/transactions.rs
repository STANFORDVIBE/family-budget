//! Financial operations: create, edit, delete/restore, confirm pending, list with filters.

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};

use super::accounts::BALANCE_SQL;
use super::rates::{self, RateInput};
use super::{
    Change, Table, clean_optional, currency_decimals, current_user, ensure_in_workspace, id_or_new, now_millis,
    record_change, settings, workspace_base,
};
use crate::domain::dates::{format_date, parse_date};
use crate::domain::ledger::{self, AccountRef, Conversion, EntryLine, TransferInput, TxKind};
use crate::domain::money::{self, Rate};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    /// Client-generated id: repeating a create with the same id never makes a duplicate.
    pub id: Option<String>,
    pub kind: String,
    pub date: String,
    pub account_id: String,
    /// Positive amount in the account currency. For an adjustment: the signed change.
    pub amount: i64,
    /// For an adjustment: the real balance; the change is computed from it.
    pub target_balance: Option<i64>,
    pub to_account_id: Option<String>,
    pub to_amount: Option<i64>,
    pub fee: Option<i64>,
    pub category_id: Option<String>,
    pub member_id: Option<String>,
    pub comment: Option<String>,
    /// Manual rate "1 account currency = X base currency" for that date; also saved for reuse.
    pub rate: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub date: String,
    pub account_id: String,
    /// Signed change of the (source) account, in its currency, without the transfer fee.
    pub amount: i64,
    pub currency: String,
    /// Signed value in the workspace base currency; None while a pending rate is unknown.
    pub base_amount: Option<i64>,
    pub rate: Option<String>,
    pub to_account_id: Option<String>,
    pub to_amount: Option<i64>,
    pub to_currency: Option<String>,
    pub fee: i64,
    pub category_id: Option<String>,
    pub member_id: Option<String>,
    pub comment: Option<String>,
    pub created_by: String,
    pub recurring_rule_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub kinds: Option<Vec<String>>,
    pub account_id: Option<String>,
    /// Includes subcategories.
    pub category_id: Option<String>,
    pub member_id: Option<String>,
    pub currency: Option<String>,
    pub search: Option<String>,
    /// "posted" (default), "pending" or "all".
    pub status: Option<String>,
    /// "date_desc" (default), "date_asc", "amount_desc", "amount_asc".
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPage {
    pub items: Vec<Transaction>,
    pub total: i64,
}

const SELECT: &str = "SELECT t.id, t.kind, t.status, t.occurred_on, m.account_id, m.amount_minor, m.currency,
        m.base_amount_minor, m.rate, tr.to_account_id, tr.to_amount_minor, tr.to_currency, COALESCE(tr.fee_minor, 0),
        t.category_id, t.member_id, t.comment, t.created_by, t.recurring_rule_id, t.created_at, t.updated_at, t.version
    FROM transactions t
    JOIN transaction_entries m ON m.transaction_id = t.id AND m.role IN ('main', 'transfer_out')
    LEFT JOIN transfers tr ON tr.transaction_id = t.id
    LEFT JOIN categories c ON c.id = t.category_id";

fn from_row(r: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: r.get(0)?,
        kind: r.get(1)?,
        status: r.get(2)?,
        date: r.get(3)?,
        account_id: r.get(4)?,
        amount: r.get(5)?,
        currency: r.get(6)?,
        base_amount: r.get(7)?,
        rate: r.get(8)?,
        to_account_id: r.get(9)?,
        to_amount: r.get(10)?,
        to_currency: r.get(11)?,
        fee: r.get(12)?,
        category_id: r.get(13)?,
        member_id: r.get(14)?,
        comment: r.get(15)?,
        created_by: r.get(16)?,
        recurring_rule_id: r.get(17)?,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
        version: r.get(20)?,
    })
}

pub fn get(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Transaction> {
    conn.query_row(
        &format!("{SELECT} WHERE t.id = ?1 AND t.workspace_id = ?2 AND t.deleted_at IS NULL"),
        params![id, workspace_id],
        from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

fn get_any(conn: &Connection, workspace_id: &str, id: &str) -> AppResult<Transaction> {
    conn.query_row(&format!("{SELECT} WHERE t.id = ?1 AND t.workspace_id = ?2"), params![id, workspace_id], from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub fn list(conn: &Connection, workspace_id: &str, filter: &TransactionFilter) -> AppResult<TransactionPage> {
    let mut sql = String::from(" WHERE t.workspace_id = ? AND t.deleted_at IS NULL");
    let mut args: Vec<Value> = vec![Value::Text(workspace_id.to_string())];

    match filter.status.as_deref().unwrap_or("posted") {
        "posted" => sql.push_str(" AND t.status = 'posted'"),
        "pending" => sql.push_str(" AND t.status = 'pending'"),
        "all" => {}
        _ => return Err(AppError::Validation("status")),
    }
    if let Some(from) = &filter.from {
        sql.push_str(" AND t.occurred_on >= ?");
        args.push(Value::Text(format_date(parse_date(from, "from")?)));
    }
    if let Some(to) = &filter.to {
        sql.push_str(" AND t.occurred_on <= ?");
        args.push(Value::Text(format_date(parse_date(to, "to")?)));
    }
    if let Some(kinds) = filter.kinds.as_ref().filter(|k| !k.is_empty()) {
        let mut marks = Vec::new();
        for kind in kinds {
            args.push(Value::Text(TxKind::parse(kind)?.as_str().to_string()));
            marks.push("?");
        }
        sql.push_str(&format!(" AND t.kind IN ({})", marks.join(", ")));
    }
    if let Some(account) = &filter.account_id {
        sql.push_str(" AND (m.account_id = ? OR tr.to_account_id = ?)");
        args.push(Value::Text(account.clone()));
        args.push(Value::Text(account.clone()));
    }
    if let Some(category) = &filter.category_id {
        sql.push_str(" AND (t.category_id = ? OR c.parent_id = ?)");
        args.push(Value::Text(category.clone()));
        args.push(Value::Text(category.clone()));
    }
    if let Some(member) = &filter.member_id {
        sql.push_str(" AND t.member_id = ?");
        args.push(Value::Text(member.clone()));
    }
    if let Some(currency) = &filter.currency {
        sql.push_str(" AND (m.currency = ? OR tr.to_currency = ?)");
        args.push(Value::Text(currency.clone()));
        args.push(Value::Text(currency.clone()));
    }
    if let Some(search) = filter.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let pattern = format!("%{}%", escape_like(&search.chars().take(100).collect::<String>()));
        sql.push_str(
            " AND (t.comment LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
                   OR EXISTS (SELECT 1 FROM accounts a WHERE a.id IN (m.account_id, tr.to_account_id)
                              AND a.name LIKE ? ESCAPE '\\'))",
        );
        for _ in 0..3 {
            args.push(Value::Text(pattern.clone()));
        }
    }

    let total: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM transactions t
             JOIN transaction_entries m ON m.transaction_id = t.id AND m.role IN ('main', 'transfer_out')
             LEFT JOIN transfers tr ON tr.transaction_id = t.id
             LEFT JOIN categories c ON c.id = t.category_id {sql}"
        ),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let order = match filter.sort.as_deref().unwrap_or("date_desc") {
        "date_desc" => "t.occurred_on DESC, t.created_at DESC",
        "date_asc" => "t.occurred_on ASC, t.created_at ASC",
        "amount_desc" => "ABS(COALESCE(m.base_amount_minor, m.amount_minor)) DESC, t.occurred_on DESC",
        "amount_asc" => "ABS(COALESCE(m.base_amount_minor, m.amount_minor)) ASC, t.occurred_on DESC",
        _ => return Err(AppError::Validation("sort")),
    };
    let limit = filter.limit.unwrap_or(100).clamp(1, 5000);
    let offset = filter.offset.unwrap_or(0).max(0);
    args.push(Value::Integer(limit));
    args.push(Value::Integer(offset));
    let mut stmt = conn.prepare(&format!("{SELECT}{sql} ORDER BY {order} LIMIT ? OFFSET ?"))?;
    let items = stmt.query_map(params_from_iter(args.iter()), from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(TransactionPage { items, total })
}

struct AccountInfo {
    reference: AccountRef,
    is_active: bool,
    balance: i64,
}

fn account(conn: &Connection, workspace_id: &str, id: &str, field: &'static str) -> AppResult<AccountInfo> {
    let row: Option<(String, bool, i64)> = conn
        .query_row(
            &format!(
                "SELECT a.currency, a.is_active, {BALANCE_SQL} FROM accounts a
                 WHERE a.id = ?1 AND a.workspace_id = ?2 AND a.deleted_at IS NULL"
            ),
            params![id, workspace_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (currency, is_active, balance) = row.ok_or(AppError::Validation(field))?;
    let decimals = currency_decimals(conn, &currency)?;
    Ok(AccountInfo { reference: AccountRef { id: id.to_string(), currency, decimals }, is_active, balance })
}

/// Rate for `currency` on `date`: the one typed into the form (saved for reuse), else the stored one.
fn conversion(
    conn: &Connection,
    workspace_id: &str,
    currency: &str,
    date: &str,
    manual: Option<&str>,
) -> AppResult<Option<Conversion>> {
    if let Some(text) = manual.map(str::trim).filter(|t| !t.is_empty()) {
        let base = workspace_base(conn, workspace_id)?;
        if currency != base.code {
            let saved = rates::upsert_in(
                conn,
                workspace_id,
                &RateInput { currency: currency.to_string(), rate: text.to_string(), rate_date: date.to_string() },
            )?;
            return Ok(Some(Conversion {
                rate: Rate::parse(&saved.rate)?,
                rate_date: saved.rate_date,
                source: saved.source,
            }));
        }
    }
    rates::find(conn, workspace_id, currency, date)
}

struct Prepared {
    kind: TxKind,
    date: String,
    entries: Vec<EntryLine>,
    transfer: Option<(TransferInput, Rate)>,
    category_id: Option<String>,
    member_id: Option<String>,
    comment: Option<String>,
}

/// Validates the input against the workspace and builds the ledger entries.
/// `editing` is the operation being replaced: its own effect is excluded from the balance
/// used for adjustments, and its (possibly archived) accounts stay allowed.
fn prepare(
    conn: &Connection,
    workspace_id: &str,
    input: &TransactionInput,
    editing: Option<&Transaction>,
    pending: bool,
) -> AppResult<Prepared> {
    let kind = TxKind::parse(&input.kind)?;
    let date = format_date(parse_date(&input.date, "date")?);
    let base = workspace_base(conn, workspace_id)?;

    let from = account(conn, workspace_id, &input.account_id, "account_id")?;
    let was_used = |id: &str| editing.is_some_and(|t| t.account_id == id || t.to_account_id.as_deref() == Some(id));
    if !from.is_active && !was_used(&input.account_id) {
        return Err(AppError::Validation("account_id"));
    }

    let category_id = match kind.category_kind() {
        Some(expected) => match input.category_id.as_deref().filter(|c| !c.is_empty()) {
            Some(id) => {
                let cat_kind: Option<String> = conn
                    .query_row(
                        "SELECT kind FROM categories WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
                        params![id, workspace_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if cat_kind.as_deref() != Some(expected) {
                    return Err(AppError::Validation("category_id"));
                }
                Some(id.to_string())
            }
            None if kind.requires_category() => return Err(AppError::Validation("category_id")),
            None => None,
        },
        None => None,
    };

    let member_id = match input.member_id.as_deref().filter(|m| !m.is_empty()) {
        Some(id) => {
            ensure_in_workspace(conn, Table::Members, id, workspace_id)
                .map_err(|_| AppError::Validation("member_id"))?;
            Some(id.to_string())
        }
        None => None,
    };
    let comment = clean_optional(input.comment.as_deref(), 500, "comment")?;

    let (entries, transfer) = match kind {
        TxKind::Transfer => {
            let to_id = input.to_account_id.as_deref().ok_or(AppError::Validation("to_account_id"))?;
            let to = account(conn, workspace_id, to_id, "to_account_id")?;
            if !to.is_active && !was_used(to_id) {
                return Err(AppError::Validation("to_account_id"));
            }
            let same = from.reference.currency == to.reference.currency;
            let transfer = TransferInput {
                from: from.reference.clone(),
                to: to.reference,
                from_amount: input.amount,
                to_amount: if same {
                    input.amount
                } else {
                    input.to_amount.ok_or(AppError::Validation("to_amount"))?
                },
                fee: input.fee.unwrap_or(0),
            };
            let needs_rate = transfer.from.currency != base.code && transfer.to.currency != base.code;
            let from_conversion = if needs_rate {
                let c = conversion(conn, workspace_id, &transfer.from.currency, &date, input.rate.as_deref())?;
                Some(c.ok_or_else(|| AppError::RateMissing(transfer.from.currency.clone()))?)
            } else {
                None
            };
            let built = ledger::transfer_entries(&transfer, &base, from_conversion.as_ref(), &date)?;
            (built.entries, Some((transfer, built.rate)))
        }
        _ => {
            let amount = match (kind, input.target_balance) {
                (TxKind::Adjustment, Some(target)) => {
                    money::require_in_range(target, "target_balance")?;
                    let own = match editing {
                        Some(t) if t.status == "posted" && t.account_id == input.account_id => t.amount,
                        _ => 0,
                    };
                    target - (from.balance - own)
                }
                _ => input.amount,
            };
            let c = conversion(conn, workspace_id, &from.reference.currency, &date, input.rate.as_deref())?;
            let entries = ledger::simple_entries(kind, &from.reference, amount, &base, c.as_ref(), &date)?;
            (entries, None)
        }
    };

    // A posted operation must always know its value in the base currency.
    if !pending && let Some(missing) = entries.iter().find(|e| e.base_amount.is_none()) {
        return Err(AppError::RateMissing(missing.currency.clone()));
    }
    Ok(Prepared { kind, date, entries, transfer, category_id, member_id, comment })
}

fn write_entries(conn: &Connection, workspace_id: &str, tx_id: &str, prepared: &Prepared, now: i64) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO transaction_entries (id, transaction_id, workspace_id, account_id, role, amount_minor, currency,
                                          base_amount_minor, rate, rate_date, rate_source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )?;
    for e in &prepared.entries {
        stmt.execute(params![
            super::new_id(),
            tx_id,
            workspace_id,
            e.account_id,
            e.role.as_str(),
            e.amount,
            e.currency,
            e.base_amount,
            e.rate,
            e.rate_date,
            e.rate_source,
            now
        ])?;
    }
    if let Some((t, rate)) = &prepared.transfer {
        conn.execute(
            "INSERT INTO transfers (transaction_id, workspace_id, from_account_id, to_account_id, from_amount_minor,
                                    from_currency, to_amount_minor, to_currency, rate, fee_minor)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                tx_id,
                workspace_id,
                t.from.id,
                t.to.id,
                t.from_amount,
                t.from.currency,
                t.to_amount,
                t.to.currency,
                rate.to_string(),
                t.fee
            ],
        )?;
    }
    Ok(())
}

/// Inserts a new operation inside the caller's transaction (also used by recurring payments).
pub(crate) fn insert(
    conn: &Connection,
    workspace_id: &str,
    id: &str,
    input: &TransactionInput,
    pending: bool,
    recurring: Option<(&str, &str)>,
) -> AppResult<Transaction> {
    let prepared = prepare(conn, workspace_id, input, None, pending)?;
    let user = current_user(conn)?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO transactions (id, workspace_id, kind, status, occurred_on, category_id, member_id, comment,
                                   created_by, recurring_rule_id, recurring_occurrence, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            id,
            workspace_id,
            prepared.kind.as_str(),
            if pending { "pending" } else { "posted" },
            prepared.date,
            prepared.category_id,
            prepared.member_id,
            prepared.comment,
            user,
            recurring.map(|r| r.0),
            recurring.map(|r| r.1),
            now
        ],
    )?;
    write_entries(conn, workspace_id, id, &prepared, now)?;
    let created = get(conn, workspace_id, id)?;
    record_change(
        conn,
        Change {
            workspace_id: Some(workspace_id),
            entity: "transaction",
            entity_id: id,
            action: "create",
            version: created.version,
            old: None,
            new: Some(&created),
        },
    )?;
    Ok(created)
}

pub fn create(conn: &mut Connection, workspace_id: &str, input: &TransactionInput) -> AppResult<Transaction> {
    let tx = conn.transaction()?;
    let id = id_or_new(input.id.as_deref())?;
    // Idempotent create: a retried request returns the operation saved the first time.
    if let Ok(existing) = get_any(&tx, workspace_id, &id) {
        return Ok(existing);
    }
    let exists_elsewhere: bool =
        tx.query_row("SELECT EXISTS (SELECT 1 FROM transactions WHERE id = ?1)", [&id], |r| r.get(0))?;
    if exists_elsewhere {
        return Err(AppError::Validation("id"));
    }
    let created = insert(&tx, workspace_id, &id, input, false, None)?;
    settings::remember_form(&tx, workspace_id, &input.kind, &input.account_id)?;
    tx.commit()?;
    Ok(created)
}

/// Replaces an operation's content. `confirm` turns a pending operation into a posted one.
fn rewrite(
    conn: &mut Connection,
    workspace_id: &str,
    id: &str,
    input: &TransactionInput,
    confirm: bool,
) -> AppResult<Transaction> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    if confirm && old.status != "pending" {
        return Err(AppError::Conflict("not_pending"));
    }
    let pending = old.status == "pending" && !confirm;
    let prepared = prepare(&tx, workspace_id, input, Some(&old), pending)?;
    let now = now_millis();
    tx.execute("DELETE FROM transfers WHERE transaction_id = ?1", [id])?;
    tx.execute("DELETE FROM transaction_entries WHERE transaction_id = ?1", [id])?;
    tx.execute(
        "UPDATE transactions SET kind = ?1, status = ?2, occurred_on = ?3, category_id = ?4, member_id = ?5,
                comment = ?6, updated_at = ?7, version = version + 1
         WHERE id = ?8",
        params![
            prepared.kind.as_str(),
            if pending { "pending" } else { "posted" },
            prepared.date,
            prepared.category_id,
            prepared.member_id,
            prepared.comment,
            now,
            id
        ],
    )?;
    write_entries(&tx, workspace_id, id, &prepared, now)?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "transaction",
            entity_id: id,
            action: if confirm { "confirm" } else { "update" },
            version: new.version,
            old: Some(&old),
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}

pub fn update(conn: &mut Connection, workspace_id: &str, id: &str, input: &TransactionInput) -> AppResult<Transaction> {
    rewrite(conn, workspace_id, id, input, false)
}

pub fn confirm(
    conn: &mut Connection,
    workspace_id: &str,
    id: &str,
    input: &TransactionInput,
) -> AppResult<Transaction> {
    rewrite(conn, workspace_id, id, input, true)
}

/// Soft delete: the operation stops counting but can be restored. Goal contributions backed by
/// this operation go with it.
pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let old = get(&tx, workspace_id, id)?;
    let now = now_millis();
    tx.execute(
        "UPDATE transactions SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE goal_contributions SET deleted_at = ?1, updated_at = ?1, version = version + 1
         WHERE transaction_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    record_change(
        &tx,
        Change::<Transaction> {
            workspace_id: Some(workspace_id),
            entity: "transaction",
            entity_id: id,
            action: if old.status == "pending" { "skip" } else { "delete" },
            version: old.version + 1,
            old: Some(&old),
            new: None,
        },
    )?;
    tx.commit()?;
    Ok(())
}

pub fn restore(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<Transaction> {
    let tx = conn.transaction()?;
    let deleted_at: Option<i64> = tx
        .query_row(
            "SELECT deleted_at FROM transactions WHERE id = ?1 AND workspace_id = ?2",
            params![id, workspace_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    let Some(deleted_at) = deleted_at else {
        return get(&tx, workspace_id, id);
    };
    let now = now_millis();
    tx.execute(
        "UPDATE transactions SET deleted_at = NULL, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now, id],
    )?;
    tx.execute(
        "UPDATE goal_contributions SET deleted_at = NULL, updated_at = ?1, version = version + 1
         WHERE transaction_id = ?2 AND deleted_at = ?3",
        params![now, id, deleted_at],
    )?;
    let new = get(&tx, workspace_id, id)?;
    record_change(
        &tx,
        Change {
            workspace_id: Some(workspace_id),
            entity: "transaction",
            entity_id: id,
            action: "restore",
            version: new.version,
            old: None,
            new: Some(&new),
        },
    )?;
    tx.commit()?;
    Ok(new)
}
