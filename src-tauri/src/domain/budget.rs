//! Budget limits: how much of a limit is used and where spending is heading.

use serde::Serialize;

use super::dates::{Date, month_end, month_start};
use super::money;

/// Share of a limit at which the user gets a warning, in basis points (80 %).
pub const WARNING_THRESHOLD_BP: i64 = 8_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LimitStatus {
    Ok,
    Warning,
    Over,
}

pub fn limit_status(spent: i64, limit: i64) -> LimitStatus {
    // Exact comparison (no rounding): 79.99 % must not show a warning.
    let reached_warning = i128::from(spent) * 10_000 >= i128::from(limit) * i128::from(WARNING_THRESHOLD_BP);
    if spent > limit {
        LimitStatus::Over
    } else if reached_warning && limit > 0 {
        LimitStatus::Warning
    } else {
        LimitStatus::Ok
    }
}

/// Days of history that define the everyday spending pace.
pub const PACE_DAYS: i64 = 30;

/// Expected spending by the end of `month`: what is spent so far plus the remaining days at the
/// pace of the last 30 days (`recent` = spending over those days). The month-to-date pace would
/// turn one purchase on the 2nd into a whole month of such purchases.
/// Past and future months return the spent amount as is.
pub fn forecast_month(spent: i64, recent: i64, month: Date, today: Date) -> i64 {
    let start = month_start(month);
    let end = month_end(month);
    if today < start || today > end {
        return spent;
    }
    spent + money::scale(recent.max(0), (end - today).num_days(), PACE_DAYS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::dates::parse_date;

    fn d(s: &str) -> Date {
        parse_date(s, "date").unwrap()
    }

    #[test]
    fn statuses_at_thresholds() {
        assert_eq!(limit_status(0, 50_000), LimitStatus::Ok);
        assert_eq!(limit_status(39_999, 50_000), LimitStatus::Ok);
        assert_eq!(limit_status(40_000, 50_000), LimitStatus::Warning);
        assert_eq!(limit_status(50_000, 50_000), LimitStatus::Warning);
        assert_eq!(limit_status(50_001, 50_000), LimitStatus::Over);
        assert_eq!(limit_status(1, 0), LimitStatus::Over);
        assert_eq!(limit_status(0, 0), LimitStatus::Ok);
    }

    #[test]
    fn forecast_follows_the_30_day_pace() {
        // 300 over the last 30 days = 10 a day; 20 days left after June 10 → 100 spent + 200
        assert_eq!(forecast_month(10_000, 30_000, d("2025-06-01"), d("2025-06-10")), 30_000);
        // One big purchase on the 2nd is not multiplied by 15
        assert_eq!(forecast_month(10_000, 10_000, d("2025-06-01"), d("2025-06-02")), 19_333);
        assert_eq!(forecast_month(10_000, 30_000, d("2025-06-01"), d("2025-07-02")), 10_000);
        assert_eq!(forecast_month(0, 0, d("2025-06-01"), d("2025-06-10")), 0);
    }
}
