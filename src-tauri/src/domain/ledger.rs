//! Turning a financial operation into ledger entries.
//!
//! Every operation is stored as signed entries per account. Balances are the sum of entries,
//! so they can always be rebuilt from history. Each entry also carries its value in the
//! workspace base currency at the historical rate, which is what analytics adds up.

use serde::{Deserialize, Serialize};

use super::money::{self, Rate};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxKind {
    Expense,
    Income,
    Transfer,
    Refund,
    Adjustment,
}

impl TxKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TxKind::Expense => "expense",
            TxKind::Income => "income",
            TxKind::Transfer => "transfer",
            TxKind::Refund => "refund",
            TxKind::Adjustment => "adjustment",
        }
    }

    pub fn parse(text: &str) -> AppResult<TxKind> {
        Ok(match text {
            "expense" => TxKind::Expense,
            "income" => TxKind::Income,
            "transfer" => TxKind::Transfer,
            "refund" => TxKind::Refund,
            "adjustment" => TxKind::Adjustment,
            _ => return Err(AppError::Validation("kind")),
        })
    }

    /// Which category kind an operation of this type must use, if any.
    pub fn category_kind(self) -> Option<&'static str> {
        match self {
            TxKind::Expense | TxKind::Refund => Some("expense"),
            TxKind::Income => Some("income"),
            TxKind::Transfer | TxKind::Adjustment => None,
        }
    }

    /// Income and expenses require a category; a refund may name the category it reduces.
    pub fn requires_category(self) -> bool {
        matches!(self, TxKind::Expense | TxKind::Income)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryRole {
    Main,
    TransferOut,
    TransferIn,
    Fee,
}

impl EntryRole {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryRole::Main => "main",
            EntryRole::TransferOut => "transfer_out",
            EntryRole::TransferIn => "transfer_in",
            EntryRole::Fee => "fee",
        }
    }
}

/// An account as the ledger sees it.
#[derive(Debug, Clone)]
pub struct AccountRef {
    pub id: String,
    pub currency: String,
    pub decimals: u32,
}

/// The workspace base currency.
#[derive(Debug, Clone)]
pub struct BaseCurrency {
    pub code: String,
    pub decimals: u32,
}

/// Rate from some currency to the base currency, valid for the operation date.
#[derive(Debug, Clone)]
pub struct Conversion {
    pub rate: Rate,
    pub rate_date: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryLine {
    pub account_id: String,
    pub role: EntryRole,
    pub amount: i64,
    pub currency: String,
    /// None only for a pending operation whose rate is not known yet.
    pub base_amount: Option<i64>,
    pub rate: Option<String>,
    pub rate_date: Option<String>,
    pub rate_source: Option<String>,
}

fn line(
    account: &AccountRef,
    role: EntryRole,
    amount: i64,
    base: &BaseCurrency,
    conversion: Option<&Conversion>,
    date: &str,
) -> AppResult<EntryLine> {
    let (base_amount, rate, rate_date, rate_source) = if account.currency == base.code {
        (Some(amount), Some("1".to_string()), Some(date.to_string()), Some("same".to_string()))
    } else if let Some(c) = conversion {
        (
            Some(money::convert(amount, account.decimals, base.decimals, &c.rate)?),
            Some(c.rate.to_string()),
            Some(c.rate_date.clone()),
            Some(c.source.clone()),
        )
    } else {
        (None, None, None, None)
    };
    Ok(EntryLine {
        account_id: account.id.clone(),
        role,
        amount,
        currency: account.currency.clone(),
        base_amount,
        rate,
        rate_date,
        rate_source,
    })
}

/// Entries of an expense, income, refund or balance adjustment on one account.
///
/// `amount` is positive for expense/income/refund (the sign comes from the type) and a non-zero
/// signed delta for an adjustment.
pub fn simple_entries(
    kind: TxKind,
    account: &AccountRef,
    amount: i64,
    base: &BaseCurrency,
    conversion: Option<&Conversion>,
    date: &str,
) -> AppResult<Vec<EntryLine>> {
    let signed = match kind {
        TxKind::Expense => -money::require_positive(amount, "amount")?,
        TxKind::Income | TxKind::Refund => money::require_positive(amount, "amount")?,
        TxKind::Adjustment => {
            money::require_in_range(amount, "amount")?;
            if amount == 0 {
                return Err(AppError::Validation("amount"));
            }
            amount
        }
        TxKind::Transfer => return Err(AppError::Validation("kind")),
    };
    Ok(vec![line(account, EntryRole::Main, signed, base, conversion, date)?])
}

#[derive(Debug, Clone)]
pub struct TransferInput {
    pub from: AccountRef,
    pub to: AccountRef,
    /// Leaves the source account (without the fee).
    pub from_amount: i64,
    /// Arrives on the destination account.
    pub to_amount: i64,
    /// Extra charge taken from the source account, in its currency.
    pub fee: i64,
}

#[derive(Debug, Clone)]
pub struct TransferEntries {
    pub entries: Vec<EntryLine>,
    /// How many destination units one source unit bought.
    pub rate: Rate,
}

/// Entries of a transfer. The moved value is the same on both sides in base currency, so a
/// transfer never shows up as income or expense; only the fee is a real cost.
///
/// `from_conversion` (source currency → base) is needed only when neither side is in the base
/// currency.
pub fn transfer_entries(
    input: &TransferInput,
    base: &BaseCurrency,
    from_conversion: Option<&Conversion>,
    date: &str,
) -> AppResult<TransferEntries> {
    if input.from.id == input.to.id {
        return Err(AppError::Validation("to_account"));
    }
    money::require_positive(input.from_amount, "amount")?;
    money::require_positive(input.to_amount, "to_amount")?;
    if input.fee < 0 || input.fee > money::MAX_AMOUNT {
        return Err(AppError::Validation("fee"));
    }
    let same_currency = input.from.currency == input.to.currency;
    if same_currency && input.from_amount != input.to_amount {
        return Err(AppError::Validation("to_amount"));
    }

    let rate = if same_currency {
        Rate::ONE
    } else {
        Rate::from_amounts(input.from_amount, input.from.decimals, input.to_amount, input.to.decimals)?
    };

    // Value of the moved money and of the fee in base currency.
    let (value, fee_value, rate_text, source) = if input.from.currency == base.code {
        (input.from_amount, input.fee, "1".to_string(), "same".to_string())
    } else if input.to.currency == base.code {
        let fee_value = money::convert(input.fee, input.from.decimals, base.decimals, &rate)?;
        (input.to_amount, fee_value, rate.to_string(), "transfer".to_string())
    } else {
        let c = from_conversion.ok_or_else(|| AppError::RateMissing(input.from.currency.clone()))?;
        (
            money::convert(input.from_amount, input.from.decimals, base.decimals, &c.rate)?,
            money::convert(input.fee, input.from.decimals, base.decimals, &c.rate)?,
            c.rate.to_string(),
            c.source.clone(),
        )
    };

    let make = |account: &AccountRef, role, amount, base_amount| EntryLine {
        account_id: account.id.clone(),
        role,
        amount,
        currency: account.currency.clone(),
        base_amount: Some(base_amount),
        rate: Some(rate_text.clone()),
        rate_date: Some(date.to_string()),
        rate_source: Some(source.clone()),
    };

    let mut entries = vec![make(&input.from, EntryRole::TransferOut, -input.from_amount, -value)];
    if input.fee > 0 {
        entries.push(make(&input.from, EntryRole::Fee, -input.fee, -fee_value));
    }
    entries.push(make(&input.to, EntryRole::TransferIn, input.to_amount, value));
    Ok(TransferEntries { entries, rate })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eur() -> BaseCurrency {
        BaseCurrency { code: "EUR".into(), decimals: 2 }
    }

    fn acc(id: &str, currency: &str) -> AccountRef {
        AccountRef { id: id.into(), currency: currency.into(), decimals: if currency == "JPY" { 0 } else { 2 } }
    }

    fn usd_rate() -> Conversion {
        Conversion { rate: Rate::parse("0.92").unwrap(), rate_date: "2025-01-10".into(), source: "manual".into() }
    }

    #[test]
    fn expense_and_income_signs() {
        let e = simple_entries(TxKind::Expense, &acc("a", "EUR"), 1250, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(e[0].amount, -1250);
        assert_eq!(e[0].base_amount, Some(-1250));
        let i = simple_entries(TxKind::Income, &acc("a", "EUR"), 1250, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(i[0].amount, 1250);
        let r = simple_entries(TxKind::Refund, &acc("a", "EUR"), 300, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(r[0].amount, 300);
    }

    #[test]
    fn rejects_bad_amounts() {
        assert!(simple_entries(TxKind::Expense, &acc("a", "EUR"), 0, &eur(), None, "2025-01-10").is_err());
        assert!(simple_entries(TxKind::Expense, &acc("a", "EUR"), -5, &eur(), None, "2025-01-10").is_err());
        assert!(simple_entries(TxKind::Adjustment, &acc("a", "EUR"), 0, &eur(), None, "2025-01-10").is_err());
        let adj = simple_entries(TxKind::Adjustment, &acc("a", "EUR"), -700, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(adj[0].amount, -700);
    }

    #[test]
    fn foreign_expense_is_converted_at_given_rate() {
        let e =
            simple_entries(TxKind::Expense, &acc("a", "USD"), 10_000, &eur(), Some(&usd_rate()), "2025-01-10").unwrap();
        assert_eq!(e[0].amount, -10_000);
        assert_eq!(e[0].currency, "USD");
        assert_eq!(e[0].base_amount, Some(-9_200));
        assert_eq!(e[0].rate.as_deref(), Some("0.92"));
        // without a rate the base value stays unknown (allowed only for pending operations)
        let p = simple_entries(TxKind::Expense, &acc("a", "USD"), 10_000, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(p[0].base_amount, None);
    }

    #[test]
    fn transfer_is_neutral_in_base_currency() {
        let input =
            TransferInput { from: acc("a", "EUR"), to: acc("b", "EUR"), from_amount: 5000, to_amount: 5000, fee: 0 };
        let t = transfer_entries(&input, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(t.entries.len(), 2);
        let total: i64 = t.entries.iter().map(|e| e.base_amount.unwrap()).sum();
        assert_eq!(total, 0);
        assert_eq!(t.rate, Rate::ONE);
    }

    #[test]
    fn same_currency_transfer_amounts_must_match() {
        let input =
            TransferInput { from: acc("a", "EUR"), to: acc("b", "EUR"), from_amount: 5000, to_amount: 4000, fee: 0 };
        assert!(transfer_entries(&input, &eur(), None, "2025-01-10").is_err());
        let same = TransferInput { from: acc("a", "EUR"), to: acc("a", "EUR"), from_amount: 1, to_amount: 1, fee: 0 };
        assert!(transfer_entries(&same, &eur(), None, "2025-01-10").is_err());
    }

    #[test]
    fn cross_currency_transfer_keeps_both_amounts_rate_and_fee() {
        // 100 EUR → 108 USD, bank fee 1.50 EUR
        let input = TransferInput {
            from: acc("a", "EUR"),
            to: acc("b", "USD"),
            from_amount: 10_000,
            to_amount: 10_800,
            fee: 150,
        };
        let t = transfer_entries(&input, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(t.rate.to_string(), "1.08");
        let out = &t.entries[0];
        let fee = &t.entries[1];
        let inn = &t.entries[2];
        assert_eq!((out.amount, out.base_amount), (-10_000, Some(-10_000)));
        assert_eq!((fee.role, fee.amount, fee.base_amount), (EntryRole::Fee, -150, Some(-150)));
        assert_eq!((inn.amount, inn.currency.as_str(), inn.base_amount), (10_800, "USD", Some(10_000)));
    }

    #[test]
    fn transfer_into_base_currency_uses_implied_rate_for_fee() {
        // 100 USD → 92 EUR, fee 2 USD → 1.84 EUR
        let input = TransferInput {
            from: acc("a", "USD"),
            to: acc("b", "EUR"),
            from_amount: 10_000,
            to_amount: 9_200,
            fee: 200,
        };
        let t = transfer_entries(&input, &eur(), None, "2025-01-10").unwrap();
        assert_eq!(t.entries[0].base_amount, Some(-9_200));
        assert_eq!(t.entries[1].base_amount, Some(-184));
        assert_eq!(t.entries[2].base_amount, Some(9_200));
    }

    #[test]
    fn transfer_between_two_foreign_currencies_needs_a_rate() {
        let input = TransferInput {
            from: acc("a", "USD"),
            to: acc("b", "JPY"),
            from_amount: 10_000,
            to_amount: 15_000,
            fee: 0,
        };
        assert!(
            matches!(transfer_entries(&input, &eur(), None, "2025-01-10"), Err(AppError::RateMissing(c)) if c == "USD")
        );
        let t = transfer_entries(&input, &eur(), Some(&usd_rate()), "2025-01-10").unwrap();
        assert_eq!(t.entries[0].base_amount, Some(-9_200));
        assert_eq!(t.entries[1].base_amount, Some(9_200));
        assert_eq!(t.entries[1].amount, 15_000);
    }
}
