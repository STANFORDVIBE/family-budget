//! Savings goals: progress and the monthly amount needed to reach the target in time.

use chrono::Datelike;
use serde::Serialize;

use super::dates::Date;
use super::money;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    pub current: i64,
    pub remaining: i64,
    pub percent_bp: i64,
    /// Whole calendar months left until the target date (at least 1 while it is not overdue).
    pub months_left: Option<i64>,
    /// Amount to set aside each month to reach the target on time.
    pub monthly_needed: Option<i64>,
    pub overdue: bool,
}

pub fn progress(target: i64, current: i64, target_date: Option<Date>, today: Date) -> GoalProgress {
    let remaining = (target - current).max(0);
    let percent_bp = money::basis_points(current.max(0), target).min(10_000);
    let (months_left, overdue) = match target_date {
        Some(date) if date < today => (None, remaining > 0),
        Some(date) => {
            let months =
                i64::from(date.year() - today.year()) * 12 + i64::from(date.month()) - i64::from(today.month());
            (Some(months.max(1)), false)
        }
        None => (None, false),
    };
    let monthly_needed = if remaining == 0 {
        target_date.map(|_| 0)
    } else if overdue {
        Some(remaining)
    } else {
        months_left.map(|m| (remaining + m - 1) / m)
    };
    GoalProgress { current, remaining, percent_bp, months_left, monthly_needed, overdue }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::dates::parse_date;

    fn d(s: &str) -> Date {
        parse_date(s, "date").unwrap()
    }

    #[test]
    fn monthly_amount_rounds_up() {
        let p = progress(100_000, 10_000, Some(d("2025-12-15")), d("2025-06-20"));
        assert_eq!(p.remaining, 90_000);
        assert_eq!(p.percent_bp, 1_000);
        assert_eq!(p.months_left, Some(6));
        assert_eq!(p.monthly_needed, Some(15_000));
        let odd = progress(100_000, 0, Some(d("2025-09-01")), d("2025-06-01"));
        assert_eq!(odd.monthly_needed, Some(33_334));
    }

    #[test]
    fn same_month_and_overdue_goals() {
        let p = progress(50_000, 0, Some(d("2025-06-30")), d("2025-06-01"));
        assert_eq!(p.months_left, Some(1));
        assert_eq!(p.monthly_needed, Some(50_000));
        let late = progress(50_000, 20_000, Some(d("2025-05-01")), d("2025-06-01"));
        assert!(late.overdue);
        assert_eq!(late.monthly_needed, Some(30_000));
    }

    #[test]
    fn reached_goal_caps_at_100_percent() {
        let p = progress(50_000, 60_000, None, d("2025-06-01"));
        assert_eq!(p.remaining, 0);
        assert_eq!(p.percent_bp, 10_000);
        assert_eq!(p.monthly_needed, None);
    }
}
