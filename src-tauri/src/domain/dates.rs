//! Calendar helpers. Financial dates are plain calendar days ('YYYY-MM-DD') without time zones.

use chrono::{Datelike, Duration, Months, NaiveDate};

use crate::error::{AppError, AppResult};

pub type Date = NaiveDate;

pub fn parse_date(text: &str, field: &'static str) -> AppResult<Date> {
    let date = NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d").map_err(|_| AppError::Validation(field))?;
    // Sanity window: keeps typos like year 20255 out of the ledger.
    if !(1970..=2200).contains(&date.year()) {
        return Err(AppError::Validation(field));
    }
    Ok(date)
}

pub fn format_date(date: Date) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// 'YYYY-MM' → first day of that month.
pub fn parse_month(text: &str) -> AppResult<Date> {
    parse_date(&format!("{}-01", text.trim()), "month")
}

pub fn format_month(date: Date) -> String {
    date.format("%Y-%m").to_string()
}

pub fn month_start(date: Date) -> Date {
    date.with_day(1).unwrap_or(date)
}

pub fn month_end(date: Date) -> Date {
    month_start(date).checked_add_months(Months::new(1)).and_then(|d| d.pred_opt()).unwrap_or(date)
}

pub fn days_in_month(date: Date) -> i64 {
    i64::from(month_end(date).day())
}

pub fn add_months_clamped(date: Date, months: u32) -> Option<Date> {
    date.checked_add_months(Months::new(months))
}

pub fn prev_month(date: Date) -> Date {
    month_start(date).checked_sub_months(Months::new(1)).unwrap_or(date)
}

/// Inclusive number of days from `from` to `to`.
pub fn days_inclusive(from: Date, to: Date) -> i64 {
    (to - from).num_days() + 1
}

pub fn add_days(date: Date, days: i64) -> Date {
    date.checked_add_signed(Duration::days(days)).unwrap_or(date)
}

pub fn today() -> Date {
    chrono::Local::now().date_naive()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Date {
        parse_date(s, "date").unwrap()
    }

    #[test]
    fn month_boundaries() {
        assert_eq!(month_end(d("2024-02-10")), d("2024-02-29"));
        assert_eq!(month_end(d("2025-12-31")), d("2025-12-31"));
        assert_eq!(days_in_month(d("2025-02-01")), 28);
        assert_eq!(prev_month(d("2025-01-15")), d("2024-12-01"));
        assert_eq!(parse_month("2025-03").unwrap(), d("2025-03-01"));
    }

    #[test]
    fn rejects_garbage_dates() {
        assert!(parse_date("2025-02-30", "date").is_err());
        assert!(parse_date("20255-01-01", "date").is_err());
        assert!(parse_date("01.02.2025", "date").is_err());
    }
}
