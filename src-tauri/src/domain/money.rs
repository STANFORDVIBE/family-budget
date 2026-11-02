//! Exact money arithmetic. Amounts are integer minor units (i64); exchange rates are exact
//! decimals (mantissa / 10^scale). Floats never appear in financial calculations.

use std::fmt;

use crate::error::{AppError, AppResult};

/// Largest amount accepted from the user: 10^15 minor units (10 trillion in a 2-decimal currency).
/// Keeps every sum of realistic size far away from i64 overflow.
pub const MAX_AMOUNT: i64 = 1_000_000_000_000_000;

/// Number of decimal places kept when a rate is derived from two amounts.
const DERIVED_RATE_SCALE: u32 = 10;
const MAX_RATE_SCALE: u32 = 12;

/// Exchange rate: one unit of the source currency costs `mantissa / 10^scale` target units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rate {
    mantissa: i128,
    scale: u32,
}

impl Rate {
    pub const ONE: Rate = Rate { mantissa: 1, scale: 0 };

    /// Parses "97.45", "97,45" or "1". Rejects zero, negatives, exponents and junk.
    pub fn parse(text: &str) -> AppResult<Rate> {
        let text = text.trim().replace(',', ".");
        let invalid = AppError::Validation("rate");
        if text.is_empty() || text.len() > 32 {
            return Err(invalid);
        }
        let (int_part, frac_part) = match text.split_once('.') {
            Some((i, f)) => (i, f),
            None => (text.as_str(), ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(invalid);
        }
        if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
            return Err(invalid);
        }
        let frac_part = frac_part.trim_end_matches('0');
        let scale = u32::try_from(frac_part.len()).map_err(|_| AppError::Validation("rate"))?;
        if scale > MAX_RATE_SCALE {
            return Err(invalid);
        }
        let digits = format!("{int_part}{frac_part}");
        let mantissa: i128 = digits.parse().map_err(|_| AppError::Validation("rate"))?;
        if mantissa <= 0 || mantissa > 10_i128.pow(18) {
            return Err(invalid);
        }
        Ok(Rate { mantissa, scale })
    }

    /// Rate implied by two amounts of the same value: `to / from`, e.g. 100 EUR → 10 950 RUB = 109.5.
    pub fn from_amounts(from_minor: i64, from_decimals: u32, to_minor: i64, to_decimals: u32) -> AppResult<Rate> {
        if from_minor <= 0 || to_minor <= 0 {
            return Err(AppError::Validation("amount"));
        }
        // (to / 10^td) / (from / 10^fd) * 10^S  =  to * 10^(fd + S) / (from * 10^td)
        let numerator = i128::from(to_minor) * pow10(from_decimals + DERIVED_RATE_SCALE);
        let denominator = i128::from(from_minor) * pow10(to_decimals);
        let mantissa = div_round(numerator, denominator);
        if mantissa <= 0 {
            return Err(AppError::Validation("rate"));
        }
        Ok(Rate { mantissa, scale: DERIVED_RATE_SCALE }.normalized())
    }

    pub fn is_one(&self) -> bool {
        self.normalized() == Rate::ONE
    }

    fn normalized(self) -> Rate {
        let mut rate = self;
        while rate.scale > 0 && rate.mantissa % 10 == 0 {
            rate.mantissa /= 10;
            rate.scale -= 1;
        }
        rate
    }
}

impl fmt::Display for Rate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let rate = self.normalized();
        if rate.scale == 0 {
            return write!(f, "{}", rate.mantissa);
        }
        let divisor = pow10(rate.scale);
        let int_part = rate.mantissa / divisor;
        let frac_part = rate.mantissa % divisor;
        write!(f, "{int_part}.{frac_part:0width$}", width = rate.scale as usize)
    }
}

/// Converts `amount` (minor units, `from_decimals`) at `rate` into minor units of the target
/// currency, rounding half away from zero. Sign is preserved.
pub fn convert(amount: i64, from_decimals: u32, to_decimals: u32, rate: &Rate) -> AppResult<i64> {
    let numerator = i128::from(amount)
        .checked_mul(rate.mantissa)
        .and_then(|n| n.checked_mul(pow10(to_decimals)))
        .ok_or(AppError::Overflow)?;
    let denominator = pow10(rate.scale + from_decimals);
    i64::try_from(div_round(numerator, denominator)).map_err(|_| AppError::Overflow)
}

/// Checked sum of amounts.
pub fn sum(amounts: impl IntoIterator<Item = i64>) -> AppResult<i64> {
    amounts.into_iter().try_fold(0_i64, |acc, x| acc.checked_add(x)).ok_or(AppError::Overflow)
}

/// Validates a user-entered positive amount.
pub fn require_positive(amount: i64, field: &'static str) -> AppResult<i64> {
    if amount <= 0 || amount > MAX_AMOUNT {
        return Err(AppError::Validation(field));
    }
    Ok(amount)
}

/// Validates a user-entered amount that may be negative (opening balance, adjustment).
pub fn require_in_range(amount: i64, field: &'static str) -> AppResult<i64> {
    if amount.abs() > MAX_AMOUNT {
        return Err(AppError::Validation(field));
    }
    Ok(amount)
}

/// Share of `part` in `whole` in basis points (1 % = 100), rounded half up. 0 when `whole` is 0.
pub fn basis_points(part: i64, whole: i64) -> i64 {
    if whole == 0 {
        return 0;
    }
    i64::try_from(div_round(i128::from(part) * 10_000, i128::from(whole))).unwrap_or(i64::MAX)
}

/// `amount * numerator / denominator`, rounded half away from zero (used for pro-rata forecasts).
pub fn scale(amount: i64, numerator: i64, denominator: i64) -> i64 {
    if denominator == 0 {
        return 0;
    }
    i64::try_from(div_round(i128::from(amount) * i128::from(numerator), i128::from(denominator))).unwrap_or(i64::MAX)
}

fn pow10(exp: u32) -> i128 {
    10_i128.pow(exp)
}

/// Integer division rounding half away from zero. `d` must be positive.
fn div_round(n: i128, d: i128) -> i128 {
    let q = n / d;
    let r = n % d;
    if r.abs() * 2 >= d { if n >= 0 { q + 1 } else { q - 1 } } else { q }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_prints_rates_exactly() {
        assert_eq!(Rate::parse("97,4500").unwrap().to_string(), "97.45");
        assert_eq!(Rate::parse("1").unwrap(), Rate::ONE);
        assert_eq!(Rate::parse("0.0105").unwrap().to_string(), "0.0105");
        assert_eq!(Rate::parse(".5").unwrap().to_string(), "0.5");
        for bad in ["", "0", "0.000", "-1", "1e3", "abc", "1.2.3", " . "] {
            assert!(Rate::parse(bad).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn converts_between_currencies_with_rounding() {
        let rate = Rate::parse("97.45").unwrap();
        // 12.34 EUR → 1202.53 RUB (1202.533)
        assert_eq!(convert(1234, 2, 2, &rate).unwrap(), 120_253);
        // negative amounts keep the sign and round symmetrically
        assert_eq!(convert(-1234, 2, 2, &rate).unwrap(), -120_253);
        // 1000 JPY (0 decimals) at 0.0062 → 6.20 EUR
        assert_eq!(convert(1000, 0, 2, &Rate::parse("0.0062").unwrap()).unwrap(), 620);
        // half rounds away from zero: 0.05 * 0.5 = 0.025 → 0.03
        assert_eq!(convert(5, 2, 2, &Rate::parse("0.5").unwrap()).unwrap(), 3);
        assert_eq!(convert(-5, 2, 2, &Rate::parse("0.5").unwrap()).unwrap(), -3);
        // 1.000 BHD (3 decimals) at 2.45 → 2.45 EUR
        assert_eq!(convert(1000, 3, 2, &Rate::parse("2.45").unwrap()).unwrap(), 245);
    }

    #[test]
    fn derives_rate_from_two_amounts() {
        // 100.00 EUR became 10 950.00 RUB
        let rate = Rate::from_amounts(10_000, 2, 1_095_000, 2).unwrap();
        assert_eq!(rate.to_string(), "109.5");
        assert_eq!(convert(10_000, 2, 2, &rate).unwrap(), 1_095_000);
        // 1/3 is kept with 10 decimals
        assert_eq!(Rate::from_amounts(300, 2, 100, 2).unwrap().to_string(), "0.3333333333");
    }

    #[test]
    fn detects_overflow_instead_of_wrapping() {
        let rate = Rate::parse("1000000000").unwrap();
        assert!(matches!(convert(i64::MAX / 2, 2, 2, &rate), Err(AppError::Overflow)));
        assert!(matches!(sum([i64::MAX, 1]), Err(AppError::Overflow)));
    }

    #[test]
    fn percentages_in_basis_points() {
        assert_eq!(basis_points(400, 500), 8000);
        assert_eq!(basis_points(1, 3), 3333);
        assert_eq!(basis_points(5, 0), 0);
        assert_eq!(scale(1000, 31, 10), 3100);
    }

    #[test]
    fn validates_user_amounts() {
        assert!(require_positive(0, "amount").is_err());
        assert!(require_positive(-1, "amount").is_err());
        assert!(require_positive(MAX_AMOUNT + 1, "amount").is_err());
        assert_eq!(require_positive(1, "amount").unwrap(), 1);
        assert_eq!(require_in_range(-500, "amount").unwrap(), -500);
    }
}
