//! Manually entered exchange rates to the workspace base currency.
//! Operations copy the rate into their entries, so editing a rate never rewrites history.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Change, Table, ensure_in_workspace, new_id, now_millis, record_change, workspace_base};
use crate::domain::dates::{format_date, parse_date};
use crate::domain::ledger::Conversion;
use crate::domain::money::Rate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRate {
    pub id: String,
    pub from_currency: String,
    pub to_currency: String,
    pub rate: String,
    pub rate_date: String,
    pub source: String,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateInput {
    pub currency: String,
    pub rate: String,
    pub rate_date: String,
}

const COLUMNS: &str = "id, from_currency, to_currency, rate, rate_date, source, version";

fn from_row(r: &Row) -> rusqlite::Result<ExchangeRate> {
    Ok(ExchangeRate {
        id: r.get(0)?,
        from_currency: r.get(1)?,
        to_currency: r.get(2)?,
        rate: r.get(3)?,
        rate_date: r.get(4)?,
        source: r.get(5)?,
        version: r.get(6)?,
    })
}

/// Rates to the current base currency, newest first.
pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<ExchangeRate>> {
    let base = workspace_base(conn, workspace_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM exchange_rates
         WHERE workspace_id = ?1 AND to_currency = ?2 AND deleted_at IS NULL
         ORDER BY rate_date DESC, from_currency"
    ))?;
    let rows = stmt.query_map(params![workspace_id, base.code], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Latest known rate `currency → base` on or before `date`.
pub fn find(conn: &Connection, workspace_id: &str, currency: &str, date: &str) -> AppResult<Option<Conversion>> {
    let base = workspace_base(conn, workspace_id)?;
    if currency == base.code {
        return Ok(Some(Conversion { rate: Rate::ONE, rate_date: date.to_string(), source: "same".into() }));
    }
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT rate, rate_date, source FROM exchange_rates
             WHERE workspace_id = ?1 AND from_currency = ?2 AND to_currency = ?3 AND rate_date <= ?4
               AND deleted_at IS NULL
             ORDER BY rate_date DESC LIMIT 1",
            params![workspace_id, currency, base.code, date],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(rate, rate_date, source)| Ok(Conversion { rate: Rate::parse(&rate)?, rate_date, source })).transpose()
}

/// Saves the rate for a day (one rate per currency per day). Runs inside the caller's transaction.
pub fn upsert_in(conn: &Connection, workspace_id: &str, input: &RateInput) -> AppResult<ExchangeRate> {
    let base = workspace_base(conn, workspace_id)?;
    super::currency_decimals(conn, &input.currency)?;
    if input.currency == base.code {
        return Err(AppError::Validation("currency"));
    }
    let rate = Rate::parse(&input.rate)?.to_string();
    let date = format_date(parse_date(&input.rate_date, "rate_date")?);
    let now = now_millis();
    let existing: Option<ExchangeRate> = conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM exchange_rates
                 WHERE workspace_id = ?1 AND from_currency = ?2 AND to_currency = ?3 AND rate_date = ?4
                   AND deleted_at IS NULL"
            ),
            params![workspace_id, input.currency, base.code, date],
            from_row,
        )
        .optional()?;
    let id = match &existing {
        Some(old) => {
            conn.execute(
                "UPDATE exchange_rates SET rate = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3",
                params![rate, now, old.id],
            )?;
            old.id.clone()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO exchange_rates (id, workspace_id, from_currency, to_currency, rate, rate_date, source,
                                             created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', ?7, ?7)",
                params![id, workspace_id, input.currency, base.code, rate, date, now],
            )?;
            id
        }
    };
    let new = conn.query_row(&format!("SELECT {COLUMNS} FROM exchange_rates WHERE id = ?1"), [&id], from_row)?;
    record_change(
        conn,
        Change {
            workspace_id: Some(workspace_id),
            entity: "exchange_rate",
            entity_id: &id,
            action: if existing.is_some() { "update" } else { "create" },
            version: new.version,
            old: existing.as_ref(),
            new: Some(&new),
        },
    )?;
    Ok(new)
}

pub fn upsert(conn: &mut Connection, workspace_id: &str, input: &RateInput) -> AppResult<ExchangeRate> {
    let tx = conn.transaction()?;
    let rate = upsert_in(&tx, workspace_id, input)?;
    tx.commit()?;
    Ok(rate)
}

pub fn delete(conn: &mut Connection, workspace_id: &str, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    ensure_in_workspace(&tx, Table::Rates, id, workspace_id)?;
    let old = tx.query_row(&format!("SELECT {COLUMNS} FROM exchange_rates WHERE id = ?1"), [id], from_row)?;
    tx.execute(
        "UPDATE exchange_rates SET deleted_at = ?1, updated_at = ?1, version = version + 1 WHERE id = ?2",
        params![now_millis(), id],
    )?;
    record_change(
        &tx,
        Change::<ExchangeRate> {
            workspace_id: Some(workspace_id),
            entity: "exchange_rate",
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
