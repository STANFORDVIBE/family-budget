//! Dashboard and analytics. All totals are in the workspace base currency at each operation's
//! historical rate (stored on its entries). Transfers and balance adjustments are neither income
//! nor expense; transfer fees are expenses; refunds reduce expenses.

use std::collections::{BTreeMap, HashMap};

use chrono::Datelike;
use rusqlite::types::Value;
use rusqlite::{Connection, params_from_iter};
use serde::{Deserialize, Serialize};

use super::accounts;
use super::budgets;
use super::goals::{self, Goal};
use super::rates;
use super::recurring::{self, Upcoming};
use super::transactions::{self, Transaction, TransactionFilter};
use super::{currency_decimals, workspace_base};
use crate::domain::dates::{
    Date, add_days, days_inclusive, format_date, format_month, month_end, month_start, parse_date, prev_month, today,
};
use crate::domain::money;
use crate::error::{AppError, AppResult};

/// Net expense of one entry: expenses and fees count positive, refunds negative.
const EXPENSE_EXPR: &str = "CASE
    WHEN t.kind = 'expense' AND e.role = 'main' THEN -e.base_amount_minor
    WHEN t.kind = 'refund' AND e.role = 'main' THEN -e.base_amount_minor
    WHEN e.role = 'fee' THEN -e.base_amount_minor
    ELSE 0 END";
const INCOME_EXPR: &str = "CASE WHEN t.kind = 'income' AND e.role = 'main' THEN e.base_amount_minor ELSE 0 END";

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsFilter {
    pub from: String,
    pub to: String,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub member_id: Option<String>,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub income: i64,
    pub expense: i64,
    pub net: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    /// 'YYYY-MM-DD' for daily series, 'YYYY-MM' for monthly ones.
    pub label: String,
    pub income: i64,
    pub expense: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryAmount {
    /// Top-level category; None groups transfer fees and refunds without a category.
    pub category_id: Option<String>,
    pub amount: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryComparison {
    pub category_id: Option<String>,
    pub current: i64,
    pub previous: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalancePoint {
    pub label: String,
    pub balance: i64,
    /// Some account could not be converted for lack of a rate at that date.
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub currency: String,
    pub totals: Totals,
    pub by_month: Vec<SeriesPoint>,
    pub expense_by_category: Vec<CategoryAmount>,
    pub income_by_category: Vec<CategoryAmount>,
    pub comparison_month: String,
    pub category_comparison: Vec<CategoryComparison>,
    pub balance_history: Vec<BalancePoint>,
    pub savings_history: Vec<BalancePoint>,
    pub missing_rates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSummary {
    pub limit: i64,
    pub spent: i64,
    pub remaining: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub currency: String,
    pub from: String,
    pub to: String,
    pub total_balance: i64,
    /// Money owed on credit cards (positive number), included in the total balance as a minus.
    pub credit_debt: i64,
    pub missing_rates: Vec<String>,
    pub totals: Totals,
    pub budget: Option<BudgetSummary>,
    pub forecast_end_of_month: i64,
    pub expense_by_category: Vec<CategoryAmount>,
    pub series: Vec<SeriesPoint>,
    pub series_granularity: String,
    pub recent: Vec<Transaction>,
    pub pending: Vec<Transaction>,
    pub upcoming: Vec<Upcoming>,
    pub goals: Vec<Goal>,
    pub has_accounts: bool,
}

/// WHERE clause over `transactions t JOIN transaction_entries e` for a filter.
fn where_clause(workspace_id: &str, filter: &AnalyticsFilter) -> AppResult<(String, Vec<Value>)> {
    let from = format_date(parse_date(&filter.from, "from")?);
    let to = format_date(parse_date(&filter.to, "to")?);
    if from > to {
        return Err(AppError::Validation("to"));
    }
    let mut sql = String::from(
        " WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.status = 'posted'
          AND t.occurred_on >= ? AND t.occurred_on <= ?",
    );
    let mut args = vec![Value::Text(workspace_id.into()), Value::Text(from), Value::Text(to)];
    if let Some(category) = &filter.category_id {
        sql.push_str(" AND (t.category_id = ? OR c.parent_id = ?)");
        args.push(Value::Text(category.clone()));
        args.push(Value::Text(category.clone()));
    }
    if let Some(account) = &filter.account_id {
        sql.push_str(" AND e.account_id = ?");
        args.push(Value::Text(account.clone()));
    }
    if let Some(member) = &filter.member_id {
        sql.push_str(" AND t.member_id = ?");
        args.push(Value::Text(member.clone()));
    }
    if let Some(currency) = &filter.currency {
        sql.push_str(" AND e.currency = ?");
        args.push(Value::Text(currency.clone()));
    }
    Ok((sql, args))
}

const FROM: &str = " FROM transactions t
    JOIN transaction_entries e ON e.transaction_id = t.id
    LEFT JOIN categories c ON c.id = t.category_id";

fn totals(conn: &Connection, workspace_id: &str, filter: &AnalyticsFilter) -> AppResult<Totals> {
    let (sql, args) = where_clause(workspace_id, filter)?;
    let (income, expense): (i64, i64) = conn.query_row(
        &format!("SELECT COALESCE(SUM({INCOME_EXPR}), 0), COALESCE(SUM({EXPENSE_EXPR}), 0){FROM}{sql}"),
        params_from_iter(args.iter()),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(Totals { income, expense, net: income - expense })
}

fn series(
    conn: &Connection,
    workspace_id: &str,
    filter: &AnalyticsFilter,
    monthly: bool,
) -> AppResult<Vec<SeriesPoint>> {
    let (sql, args) = where_clause(workspace_id, filter)?;
    let key = if monthly { "substr(t.occurred_on, 1, 7)" } else { "t.occurred_on" };
    let mut stmt = conn.prepare(&format!(
        "SELECT {key}, COALESCE(SUM({INCOME_EXPR}), 0), COALESCE(SUM({EXPENSE_EXPR}), 0){FROM}{sql} GROUP BY 1"
    ))?;
    let found: HashMap<String, (i64, i64)> = stmt
        .query_map(params_from_iter(args.iter()), |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
        .collect::<Result<_, _>>()?;
    // Every day/month of the period appears, also the empty ones, so charts have no gaps.
    let from = parse_date(&filter.from, "from")?;
    let to = parse_date(&filter.to, "to")?;
    let mut labels = Vec::new();
    if monthly {
        let mut cursor = month_start(from);
        while cursor <= to {
            labels.push(format_month(cursor));
            cursor = add_days(month_end(cursor), 1);
        }
    } else {
        let mut cursor = from;
        while cursor <= to {
            labels.push(format_date(cursor));
            cursor = add_days(cursor, 1);
        }
    }
    Ok(labels
        .into_iter()
        .map(|label| {
            let (income, expense) = found.get(&label).copied().unwrap_or((0, 0));
            SeriesPoint { label, income, expense }
        })
        .collect())
}

fn by_top_category(
    conn: &Connection,
    workspace_id: &str,
    filter: &AnalyticsFilter,
    expr: &str,
) -> AppResult<Vec<CategoryAmount>> {
    let (sql, args) = where_clause(workspace_id, filter)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT COALESCE(c.parent_id, c.id), SUM({expr}) AS amount{FROM}{sql}
         GROUP BY 1 HAVING amount <> 0 ORDER BY amount DESC"
    ))?;
    let rows = stmt
        .query_map(params_from_iter(args.iter()), |r| Ok(CategoryAmount { category_id: r.get(0)?, amount: r.get(1)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Net spending per exact category (not rolled up), used by budgets. Fees are under None.
pub fn spending_by_category(
    conn: &Connection,
    workspace_id: &str,
    from: &str,
    to: &str,
) -> AppResult<HashMap<Option<String>, i64>> {
    let filter = AnalyticsFilter { from: from.into(), to: to.into(), ..Default::default() };
    let (sql, args) = where_clause(workspace_id, &filter)?;
    let mut stmt = conn.prepare(&format!("SELECT t.category_id, SUM({EXPENSE_EXPR}){FROM}{sql} GROUP BY 1"))?;
    let rows =
        stmt.query_map(params_from_iter(args.iter()), |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Account balances on `date` converted to base at the rate valid that day.
/// Returns (total, credit debt, currencies without a rate).
fn balance_on(
    conn: &Connection,
    workspace_id: &str,
    date: &str,
    account_filter: Option<&str>,
) -> AppResult<(i64, i64, Vec<String>)> {
    let base = workspace_base(conn, workspace_id)?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.currency, a.kind, a.initial_balance_minor + COALESCE((
             SELECT SUM(e.amount_minor) FROM transaction_entries e JOIN transactions t ON t.id = e.transaction_id
             WHERE e.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'posted' AND t.occurred_on <= ?2), 0)
         FROM accounts a WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL",
    )?;
    let rows: Vec<(String, String, String, i64)> = stmt
        .query_map(rusqlite::params![workspace_id, date], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let mut total = 0_i64;
    let mut debt = 0_i64;
    let mut missing = Vec::new();
    for (id, currency, kind, balance) in rows {
        if account_filter.is_some_and(|f| f != id) {
            continue;
        }
        let value = match rates::find(conn, workspace_id, &currency, date)? {
            Some(c) => money::convert(balance, currency_decimals(conn, &currency)?, base.decimals, &c.rate)?,
            None => {
                if balance != 0 && !missing.contains(&currency) {
                    missing.push(currency);
                }
                continue;
            }
        };
        total = total.checked_add(value).ok_or(AppError::Overflow)?;
        if kind == "credit_card" && value < 0 {
            debt -= value;
        }
    }
    Ok((total, debt, missing))
}

fn month_ends(from: Date, to: Date) -> Vec<Date> {
    let mut result = Vec::new();
    let mut cursor = month_start(from);
    while cursor <= to {
        result.push(month_end(cursor).min(to));
        cursor = add_days(month_end(cursor), 1);
    }
    result
}

pub fn analytics(conn: &Connection, workspace_id: &str, filter: &AnalyticsFilter) -> AppResult<Analytics> {
    let base = workspace_base(conn, workspace_id)?;
    let from = parse_date(&filter.from, "from")?;
    let to = parse_date(&filter.to, "to")?;
    let mut missing_rates = Vec::new();

    let mut balance_history = Vec::new();
    for date in month_ends(from, to) {
        let (balance, _, missing) = balance_on(conn, workspace_id, &format_date(date), filter.account_id.as_deref())?;
        balance_history.push(BalancePoint { label: format_month(date), balance, incomplete: !missing.is_empty() });
        for m in missing {
            if !missing_rates.contains(&m) {
                missing_rates.push(m);
            }
        }
    }

    // Savings: earmarked goal money, cumulative, converted to base at each month end.
    let contributions: Vec<(String, String, i64)> = conn
        .prepare(
            "SELECT c.contributed_on, g.currency, c.amount_minor FROM goal_contributions c JOIN goals g ON g.id = c.goal_id
             WHERE c.workspace_id = ?1 AND c.deleted_at IS NULL AND g.deleted_at IS NULL AND c.contributed_on <= ?2",
        )?
        .query_map(rusqlite::params![workspace_id, format_date(to)], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let mut savings_history = Vec::new();
    for date in month_ends(from, to) {
        let day = format_date(date);
        let mut per_currency: BTreeMap<&str, i64> = BTreeMap::new();
        for (on, currency, amount) in &contributions {
            if on.as_str() <= day.as_str() {
                *per_currency.entry(currency.as_str()).or_default() += amount;
            }
        }
        let mut total = 0;
        let mut incomplete = false;
        for (currency, amount) in per_currency {
            match rates::find(conn, workspace_id, currency, &day)? {
                Some(c) => total += money::convert(amount, currency_decimals(conn, currency)?, base.decimals, &c.rate)?,
                None => incomplete = true,
            }
        }
        savings_history.push(BalancePoint { label: format_month(date), balance: total, incomplete });
    }

    // Month-to-month comparison: the last month of the period against the one before it.
    let current_month = month_start(to);
    let previous_month = prev_month(current_month);
    let current = by_top_category(
        conn,
        workspace_id,
        &AnalyticsFilter {
            from: format_date(current_month),
            to: format_date(month_end(current_month)),
            ..filter.clone()
        },
        EXPENSE_EXPR,
    )?;
    let previous = by_top_category(
        conn,
        workspace_id,
        &AnalyticsFilter {
            from: format_date(previous_month),
            to: format_date(month_end(previous_month)),
            ..filter.clone()
        },
        EXPENSE_EXPR,
    )?;
    let mut comparison: Vec<CategoryComparison> = current
        .iter()
        .map(|c| CategoryComparison {
            category_id: c.category_id.clone(),
            current: c.amount,
            previous: previous.iter().find(|p| p.category_id == c.category_id).map_or(0, |p| p.amount),
        })
        .collect();
    for p in &previous {
        if !comparison.iter().any(|c| c.category_id == p.category_id) {
            comparison.push(CategoryComparison { category_id: p.category_id.clone(), current: 0, previous: p.amount });
        }
    }

    Ok(Analytics {
        currency: base.code,
        totals: totals(conn, workspace_id, filter)?,
        by_month: series(conn, workspace_id, filter, true)?,
        expense_by_category: by_top_category(conn, workspace_id, filter, EXPENSE_EXPR)?,
        income_by_category: by_top_category(conn, workspace_id, filter, INCOME_EXPR)?,
        comparison_month: format_month(current_month),
        category_comparison: comparison,
        balance_history,
        savings_history,
        missing_rates,
    })
}

pub fn dashboard(conn: &Connection, workspace_id: &str, from: &str, to: &str) -> AppResult<Dashboard> {
    let base = workspace_base(conn, workspace_id)?;
    let from_date = parse_date(from, "from")?;
    let to_date = parse_date(to, "to")?;
    let today = today();
    let filter = AnalyticsFilter { from: format_date(from_date), to: format_date(to_date), ..Default::default() };

    let (total_balance, credit_debt, missing_rates) = balance_on(conn, workspace_id, &format_date(today), None)?;
    let monthly = days_inclusive(from_date, to_date) > 62;

    let month = budgets::get(conn, workspace_id, &format_month(today))?;
    let budget = month.total_limit.map(|limit| BudgetSummary {
        limit,
        spent: month.total_spent,
        remaining: limit - month.total_spent,
    });

    let recent =
        transactions::list(conn, workspace_id, &TransactionFilter { limit: Some(8), ..Default::default() })?.items;
    let pending = transactions::list(
        conn,
        workspace_id,
        &TransactionFilter {
            status: Some("pending".into()),
            sort: Some("date_asc".into()),
            limit: Some(20),
            ..Default::default()
        },
    )?
    .items;
    let upcoming = recurring::upcoming(conn, workspace_id, 30)?;
    let goals = goals::list(conn, workspace_id)?.into_iter().filter(|g| g.status == "active").take(4).collect();

    Ok(Dashboard {
        currency: base.code.clone(),
        from: filter.from.clone(),
        to: filter.to.clone(),
        total_balance,
        credit_debt,
        missing_rates,
        totals: totals(conn, workspace_id, &filter)?,
        budget,
        forecast_end_of_month: forecast_end_of_month(conn, workspace_id, total_balance, today, &pending)?,
        expense_by_category: by_top_category(conn, workspace_id, &filter, EXPENSE_EXPR)?,
        series: series(conn, workspace_id, &filter, monthly)?,
        series_granularity: if monthly { "month".into() } else { "day".into() },
        recent,
        pending,
        upcoming,
        goals,
        has_accounts: !accounts::list(conn, workspace_id)?.is_empty(),
    })
}

/// Balance expected on the last day of this month: today's balance, plus scheduled income and
/// minus scheduled payments still due this month (pending and upcoming), minus everyday spending
/// continuing at this month's pace (spending not created by recurring rules).
fn forecast_end_of_month(
    conn: &Connection,
    workspace_id: &str,
    balance: i64,
    today: Date,
    pending: &[Transaction],
) -> AppResult<i64> {
    let base = workspace_base(conn, workspace_id)?;
    let end = month_end(today);
    let mut forecast = balance;

    for t in pending.iter().filter(|t| parse_date(&t.date, "date").is_ok_and(|d| d <= end)) {
        if let Some(value) =
            convert_to_base(conn, workspace_id, &base.code, base.decimals, t.amount, &t.currency, today)?
        {
            forecast += value;
        }
    }
    for u in recurring::upcoming(conn, workspace_id, (end - today).num_days())? {
        let signed = if u.kind == "income" { u.amount } else { -u.amount };
        if let Some(value) = convert_to_base(conn, workspace_id, &base.code, base.decimals, signed, &u.currency, today)?
        {
            forecast += value;
        }
    }

    let (sql, args) = where_clause(
        workspace_id,
        &AnalyticsFilter { from: format_date(month_start(today)), to: format_date(today), ..Default::default() },
    )?;
    let everyday: i64 = conn.query_row(
        &format!("SELECT COALESCE(SUM({EXPENSE_EXPR}), 0){FROM}{sql} AND t.recurring_rule_id IS NULL"),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;
    let elapsed = i64::from(today.day());
    let remaining_days = (end - today).num_days();
    forecast -= money::scale(everyday.max(0), remaining_days, elapsed);
    Ok(forecast)
}

fn convert_to_base(
    conn: &Connection,
    workspace_id: &str,
    base_code: &str,
    base_decimals: u32,
    amount: i64,
    currency: &str,
    date: Date,
) -> AppResult<Option<i64>> {
    if currency == base_code {
        return Ok(Some(amount));
    }
    match rates::find(conn, workspace_id, currency, &format_date(date))? {
        Some(c) => Ok(Some(money::convert(amount, currency_decimals(conn, currency)?, base_decimals, &c.rate)?)),
        None => Ok(None),
    }
}
