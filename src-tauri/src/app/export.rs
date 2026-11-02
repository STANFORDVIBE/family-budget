//! Exports: the full workspace as JSON and operations as CSV for spreadsheets.

use rusqlite::types::ValueRef;
use rusqlite::{Connection, params};
use serde_json::{Map, Value, json};

use super::transactions::{self, TransactionFilter};
use super::{currency_decimals, now_millis, workspaces};
use crate::error::AppResult;

/// Tables exported with a workspace, each filtered by `workspace_id`.
const TABLES: &[&str] = &[
    "workspace_members",
    "accounts",
    "exchange_rates",
    "categories",
    "transactions",
    "transaction_entries",
    "transfers",
    "budgets",
    "budget_limits",
    "recurring_rules",
    "goals",
    "goal_contributions",
];

fn rows_as_json(conn: &Connection, table: &str, workspace_id: &str) -> AppResult<Vec<Value>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table} WHERE workspace_id = ?1"))?;
    let names: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
    let mut rows = stmt.query([workspace_id])?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => Value::Null,
            };
            object.insert(name.clone(), value);
        }
        result.push(Value::Object(object));
    }
    Ok(result)
}

/// Everything that belongs to a workspace, including soft-deleted rows, in one JSON document.
pub fn workspace_json(conn: &Connection, workspace_id: &str) -> AppResult<Value> {
    let workspace = workspaces::get(conn, workspace_id)?;
    let mut data = Map::new();
    for table in TABLES {
        data.insert((*table).to_string(), Value::Array(rows_as_json(conn, table, workspace_id)?));
    }
    Ok(json!({
        "format": "family-budget-workspace",
        "formatVersion": 1,
        "schemaVersion": crate::db::migrations::latest_version(),
        "exportedAt": now_millis(),
        "workspace": workspace,
        "data": data,
    }))
}

/// Minor units → "1234,56" (comma decimal separator, as Excel expects in Russian locale).
pub fn format_minor(amount: i64, decimals: u32) -> String {
    let sign = if amount < 0 { "-" } else { "" };
    let abs = amount.unsigned_abs();
    if decimals == 0 {
        return format!("{sign}{abs}");
    }
    let divisor = 10_u64.pow(decimals);
    format!("{sign}{},{:0width$}", abs / divisor, abs % divisor, width = decimals as usize)
}

/// A user-typed text cell. A leading =,+,-,@ would be run as a formula by spreadsheet apps.
fn csv_text(text: &str) -> String {
    if text.starts_with(['=', '+', '-', '@']) { csv_quote(&format!("'{text}")) } else { csv_quote(text) }
}

fn csv_quote(text: &str) -> String {
    if text.contains([';', '"', '\n', '\r']) { format!("\"{}\"", text.replace('"', "\"\"")) } else { text.to_string() }
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "expense" => "Расход",
        "income" => "Доход",
        "transfer" => "Перевод",
        "refund" => "Возврат",
        _ => "Корректировка",
    }
}

/// Operations matching the filter as CSV (UTF-8 with BOM, ';' separated).
pub fn transactions_csv(conn: &Connection, workspace_id: &str, filter: &TransactionFilter) -> AppResult<String> {
    let base = super::workspace_base(conn, workspace_id)?;
    let filter = TransactionFilter { limit: Some(5000), offset: Some(0), ..filter.clone() };
    let mut out = String::from(
        "\u{feff}Дата;Тип;Счёт;Сумма;Валюта;Счёт зачисления;Сумма зачисления;Валюта зачисления;Комиссия;Сумма в основной валюте;Основная валюта;Курс;Категория;Участник;Комментарий\r\n",
    );
    let lookup = |sql: &str, id: &Option<String>| -> AppResult<String> {
        match id {
            Some(id) => Ok(conn.query_row(sql, params![id], |r| r.get::<_, String>(0)).unwrap_or_default()),
            None => Ok(String::new()),
        }
    };
    let mut offset = 0;
    loop {
        let page =
            transactions::list(conn, workspace_id, &TransactionFilter { offset: Some(offset), ..filter.clone() })?;
        if page.items.is_empty() {
            break;
        }
        for t in &page.items {
            let account = lookup("SELECT name FROM accounts WHERE id = ?1", &Some(t.account_id.clone()))?;
            let to_account = lookup("SELECT name FROM accounts WHERE id = ?1", &t.to_account_id)?;
            let category = lookup("SELECT name FROM categories WHERE id = ?1", &t.category_id)?;
            let member = lookup("SELECT name FROM workspace_members WHERE id = ?1", &t.member_id)?;
            let decimals = currency_decimals(conn, &t.currency)?;
            let to_amount = match (&t.to_amount, &t.to_currency) {
                (Some(a), Some(c)) => format_minor(*a, currency_decimals(conn, c)?),
                _ => String::new(),
            };
            let line = [
                csv_quote(&t.date),
                csv_quote(kind_label(&t.kind)),
                csv_text(&account),
                csv_quote(&format_minor(t.amount, decimals)),
                csv_quote(&t.currency),
                csv_text(&to_account),
                csv_quote(&to_amount),
                csv_quote(&t.to_currency.clone().unwrap_or_default()),
                csv_quote(&if t.fee > 0 { format_minor(t.fee, decimals) } else { String::new() }),
                csv_quote(&t.base_amount.map(|b| format_minor(b, base.decimals)).unwrap_or_default()),
                csv_quote(&base.code),
                csv_quote(&t.rate.clone().unwrap_or_default().replace('.', ",")),
                csv_text(&category),
                csv_text(&member),
                csv_text(&t.comment.clone().unwrap_or_default()),
            ];
            out.push_str(&line.join(";"));
            out.push_str("\r\n");
        }
        offset += page.items.len() as i64;
        if offset >= page.total {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_minor_units_exactly() {
        assert_eq!(format_minor(123_456, 2), "1234,56");
        assert_eq!(format_minor(-5, 2), "-0,05");
        assert_eq!(format_minor(1000, 0), "1000");
        assert_eq!(format_minor(1_234, 3), "1,234");
    }

    #[test]
    fn neutralizes_formulas_and_quotes() {
        assert_eq!(csv_text("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(csv_text("a;b"), "\"a;b\"");
        assert_eq!(csv_text("say \"hi\""), "\"say \"\"hi\"\"\"");
        // amounts are numbers, not formulas: the minus sign stays
        assert_eq!(csv_quote("-120,00"), "-120,00");
    }
}
