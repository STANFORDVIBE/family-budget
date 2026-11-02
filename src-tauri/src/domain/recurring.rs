//! Schedules of recurring payments. Occurrences are anchored to the start date, so a payment on
//! the 31st falls on the last day of shorter months and never drifts.

use serde::{Deserialize, Serialize};

use super::dates::{Date, add_days, add_months_clamped};
use crate::error::{AppError, AppResult};

/// Safety cap: never create more than this many occurrences of one rule in one pass.
pub const MAX_CATCH_UP: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntervalUnit {
    Day,
    Week,
    Month,
    Year,
}

impl IntervalUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            IntervalUnit::Day => "day",
            IntervalUnit::Week => "week",
            IntervalUnit::Month => "month",
            IntervalUnit::Year => "year",
        }
    }

    pub fn parse(text: &str) -> AppResult<IntervalUnit> {
        Ok(match text {
            "day" => IntervalUnit::Day,
            "week" => IntervalUnit::Week,
            "month" => IntervalUnit::Month,
            "year" => IntervalUnit::Year,
            _ => return Err(AppError::Validation("interval_unit")),
        })
    }
}

#[derive(Debug, Clone)]
pub struct Schedule {
    pub start: Date,
    pub unit: IntervalUnit,
    pub count: u32,
    pub end: Option<Date>,
}

impl Schedule {
    pub fn new(start: Date, unit: IntervalUnit, count: u32, end: Option<Date>) -> AppResult<Schedule> {
        if !(1..=1000).contains(&count) {
            return Err(AppError::Validation("interval_count"));
        }
        if end.is_some_and(|e| e < start) {
            return Err(AppError::Validation("end_date"));
        }
        Ok(Schedule { start, unit, count, end })
    }

    /// The n-th occurrence (0 = start date), ignoring the end date.
    fn nth(&self, n: u32) -> Option<Date> {
        let steps = n.checked_mul(self.count)?;
        match self.unit {
            IntervalUnit::Day => Some(add_days(self.start, i64::from(steps))),
            IntervalUnit::Week => Some(add_days(self.start, i64::from(steps) * 7)),
            IntervalUnit::Month => add_months_clamped(self.start, steps),
            IntervalUnit::Year => add_months_clamped(self.start, steps.checked_mul(12)?),
        }
    }

    fn within_end(&self, date: Date) -> Option<Date> {
        match self.end {
            Some(end) if date > end => None,
            _ => Some(date),
        }
    }

    /// First occurrence on or after `date`, or None if the schedule has ended by then.
    pub fn first_on_or_after(&self, date: Date) -> Option<Date> {
        if date <= self.start {
            return self.within_end(self.start);
        }
        let days = (date - self.start).num_days();
        let count = i64::from(self.count);
        let estimate = match self.unit {
            IntervalUnit::Day => days / count,
            IntervalUnit::Week => days / (7 * count),
            IntervalUnit::Month => days / (31 * count),
            IntervalUnit::Year => days / (366 * count),
        };
        let mut n = u32::try_from(estimate.max(0)).ok()?;
        loop {
            let candidate = self.nth(n)?;
            if candidate >= date {
                return self.within_end(candidate);
            }
            n = n.checked_add(1)?;
        }
    }

    /// First occurrence strictly after `date`.
    pub fn first_after(&self, date: Date) -> Option<Date> {
        self.first_on_or_after(add_days(date, 1))
    }

    /// Occurrences from `from` up to and including `until`, at most `MAX_CATCH_UP`.
    pub fn due(&self, from: Date, until: Date) -> Vec<Date> {
        let mut result = Vec::new();
        let mut cursor = self.first_on_or_after(from);
        while let Some(date) = cursor {
            if date > until || result.len() >= MAX_CATCH_UP {
                break;
            }
            result.push(date);
            cursor = self.first_after(date);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::dates::parse_date;

    fn d(s: &str) -> Date {
        parse_date(s, "date").unwrap()
    }

    #[test]
    fn monthly_on_the_31st_clamps_without_drifting() {
        let s = Schedule::new(d("2025-01-31"), IntervalUnit::Month, 1, None).unwrap();
        let due = s.due(d("2025-01-01"), d("2025-05-31"));
        assert_eq!(due, vec![d("2025-01-31"), d("2025-02-28"), d("2025-03-31"), d("2025-04-30"), d("2025-05-31")]);
    }

    #[test]
    fn weekly_daily_yearly_and_custom_intervals() {
        let w = Schedule::new(d("2025-01-06"), IntervalUnit::Week, 2, None).unwrap();
        assert_eq!(w.due(d("2025-01-06"), d("2025-02-03")), vec![d("2025-01-06"), d("2025-01-20"), d("2025-02-03")]);
        let day = Schedule::new(d("2025-01-01"), IntervalUnit::Day, 10, None).unwrap();
        assert_eq!(day.first_after(d("2025-01-01")), Some(d("2025-01-11")));
        let y = Schedule::new(d("2024-02-29"), IntervalUnit::Year, 1, None).unwrap();
        assert_eq!(y.first_after(d("2024-02-29")), Some(d("2025-02-28")));
        assert_eq!(y.first_after(d("2027-03-01")), Some(d("2028-02-29")));
    }

    #[test]
    fn respects_end_date() {
        let s = Schedule::new(d("2025-01-15"), IntervalUnit::Month, 1, Some(d("2025-03-20"))).unwrap();
        assert_eq!(s.due(d("2025-01-01"), d("2025-12-31")).len(), 3);
        assert_eq!(s.first_after(d("2025-03-15")), None);
        assert!(Schedule::new(d("2025-01-15"), IntervalUnit::Month, 1, Some(d("2025-01-01"))).is_err());
        assert!(Schedule::new(d("2025-01-15"), IntervalUnit::Month, 0, None).is_err());
    }

    #[test]
    fn catch_up_is_capped() {
        let s = Schedule::new(d("2000-01-01"), IntervalUnit::Day, 1, None).unwrap();
        assert_eq!(s.due(d("2000-01-01"), d("2025-01-01")).len(), MAX_CATCH_UP);
    }
}
