//! End-to-end financial scenarios on a real SQLite database (ТЗ, раздел 23).

use super::analytics::{self, AnalyticsFilter};
use super::testing::fixture;
use super::transactions::{self, TransactionFilter, TransactionInput};
use super::*;
use crate::app::budgets::LimitInput;
use crate::app::goals::{ContributionInput, GoalInput};
use crate::app::recurring::RecurringInput;
use crate::domain::budget::LimitStatus;
use crate::domain::dates::{format_date, parse_date};

fn expense(account: &str, amount: i64, category: &str, date: &str) -> TransactionInput {
    TransactionInput {
        kind: "expense".into(),
        date: date.into(),
        account_id: account.into(),
        amount,
        category_id: Some(category.into()),
        ..Default::default()
    }
}

fn income(account: &str, amount: i64, category: &str, date: &str) -> TransactionInput {
    TransactionInput { kind: "income".into(), ..expense(account, amount, category, date) }
}

fn transfer(from: &str, to: &str, amount: i64, to_amount: Option<i64>, fee: i64) -> TransactionInput {
    TransactionInput {
        kind: "transfer".into(),
        date: "2025-03-10".into(),
        account_id: from.into(),
        amount,
        to_account_id: Some(to.into()),
        to_amount,
        fee: Some(fee),
        ..Default::default()
    }
}

fn month(from: &str, to: &str) -> AnalyticsFilter {
    AnalyticsFilter { from: from.into(), to: to.into(), ..Default::default() }
}

#[test]
fn onboarding_creates_workspaces_with_categories_and_owner() {
    let f = fixture();
    assert_eq!(f.personal.kind, "personal");
    assert_eq!(f.family.kind, "family");
    let cats = categories::list(&f.db.conn, &f.personal.id).unwrap();
    assert_eq!(cats.iter().filter(|c| c.kind == "expense").count(), 14);
    assert_eq!(cats.iter().filter(|c| c.kind == "income").count(), 7);
    let members = members::list(&f.db.conn, &f.family.id).unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].role, "owner");
    assert!(members[0].is_me);
}

#[test]
fn income_expense_and_balance() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 10_000);
    let salary = f.category(&ws, "Зарплата");
    let food = f.category(&ws, "Продукты");

    transactions::create(&mut f.db.conn, &ws, &income(&card.id, 250_000, &salary, "2025-03-01")).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 260_000);
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 4_550, &food, "2025-03-02")).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 255_450);

    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!((totals.income, totals.expense, totals.net), (250_000, 4_550, 245_450));
}

#[test]
fn expense_requires_category_and_positive_amount() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let mut input = expense(&card.id, 100, "", "2025-03-02");
    input.category_id = None;
    assert!(matches!(transactions::create(&mut f.db.conn, &ws, &input), Err(AppError::Validation("category_id"))));
    let salary = f.category(&ws, "Зарплата");
    // an income category cannot be used for an expense
    assert!(transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 100, &salary, "2025-03-02")).is_err());
    let food = f.category(&ws, "Продукты");
    assert!(transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 0, &food, "2025-03-02")).is_err());
    assert_eq!(f.balance(&ws, &card.id), 0);
}

#[test]
fn transfers_move_money_without_touching_statistics() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 100_000);
    let cash = f.account(&ws, "Наличные", "EUR", 0);
    transactions::create(&mut f.db.conn, &ws, &transfer(&card.id, &cash.id, 30_000, None, 0)).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 70_000);
    assert_eq!(f.balance(&ws, &cash.id), 30_000);
    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(totals, analytics::Totals::default());
}

#[test]
fn cross_currency_transfer_keeps_both_amounts_and_fee() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let eur = f.account(&ws, "Евро", "EUR", 100_000);
    let usd = f.account(&ws, "Доллары", "USD", 0);
    let t = transactions::create(&mut f.db.conn, &ws, &transfer(&eur.id, &usd.id, 10_000, Some(10_850), 200)).unwrap();
    assert_eq!(t.to_amount, Some(10_850));
    assert_eq!(t.to_currency.as_deref(), Some("USD"));
    assert_eq!(t.fee, 200);
    assert_eq!(t.rate.as_deref(), Some("1"));
    assert_eq!(f.balance(&ws, &eur.id), 89_800);
    assert_eq!(f.balance(&ws, &usd.id), 10_850);
    // only the fee is an expense
    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(totals.expense, 200);
    assert_eq!(totals.income, 0);
    let rate: String =
        f.db.conn.query_row("SELECT rate FROM transfers WHERE transaction_id = ?1", [&t.id], |r| r.get(0)).unwrap();
    assert_eq!(rate, "1.085");
}

#[test]
fn refund_reduces_category_spending() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 50_000);
    let clothes = f.category(&ws, "Одежда");
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 8_000, &clothes, "2025-03-05")).unwrap();
    let refund = TransactionInput { kind: "refund".into(), ..expense(&card.id, 3_000, &clothes, "2025-03-07") };
    transactions::create(&mut f.db.conn, &ws, &refund).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 45_000);
    let a = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap();
    assert_eq!(a.totals.expense, 5_000);
    assert_eq!(a.totals.income, 0);
    assert_eq!(a.expense_by_category[0].amount, 5_000);
}

#[test]
fn editing_and_deleting_recalculate_balance_and_are_audited() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 10_000);
    let cash = f.account(&ws, "Наличные", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    let t = transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 1_000, &food, "2025-03-05")).unwrap();

    // move it to another account and change the amount
    let edited =
        transactions::update(&mut f.db.conn, &ws, &t.id, &expense(&cash.id, 2_500, &food, "2025-03-06")).unwrap();
    assert_eq!(edited.version, 2);
    assert_eq!(f.balance(&ws, &card.id), 10_000);
    assert_eq!(f.balance(&ws, &cash.id), -2_500);

    let journal =
        audit::list(&f.db.conn, &ws, &audit::AuditFilter { entity_id: Some(t.id.clone()), limit: None }).unwrap();
    assert_eq!(journal[0].action, "update");
    assert_eq!(journal[0].old_value.as_ref().unwrap()["amount"], -1_000);
    assert_eq!(journal[0].new_value.as_ref().unwrap()["amount"], -2_500);

    transactions::delete(&mut f.db.conn, &ws, &t.id).unwrap();
    assert_eq!(f.balance(&ws, &cash.id), 0);
    assert!(transactions::get(&f.db.conn, &ws, &t.id).is_err());
    transactions::restore(&mut f.db.conn, &ws, &t.id).unwrap();
    assert_eq!(f.balance(&ws, &cash.id), -2_500);
}

#[test]
fn balance_is_rebuilt_from_entries_and_adjustment_sets_real_balance() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 10_000);
    let food = f.category(&ws, "Продукты");
    for i in 1..=5 {
        transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 1_000 * i, &food, "2025-03-05")).unwrap();
    }
    let entries_sum: i64 = f
        .db
        .conn
        .query_row("SELECT SUM(amount_minor) FROM transaction_entries WHERE account_id = ?1", [&card.id], |r| r.get(0))
        .unwrap();
    assert_eq!(f.balance(&ws, &card.id), 10_000 + entries_sum);
    assert_eq!(f.balance(&ws, &card.id), -5_000);

    let adjust = TransactionInput {
        kind: "adjustment".into(),
        date: "2025-03-06".into(),
        account_id: card.id.clone(),
        target_balance: Some(1_234),
        ..Default::default()
    };
    let t = transactions::create(&mut f.db.conn, &ws, &adjust).unwrap();
    assert_eq!(t.amount, 6_234);
    assert_eq!(f.balance(&ws, &card.id), 1_234);
    // adjustments are corrections, not income
    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(totals.income, 0);
    // editing the adjustment to another real balance recomputes the change without double counting
    let again =
        transactions::update(&mut f.db.conn, &ws, &t.id, &TransactionInput { target_balance: Some(0), ..adjust })
            .unwrap();
    assert_eq!(again.amount, 5_000);
    assert_eq!(f.balance(&ws, &card.id), 0);
}

#[test]
fn create_is_idempotent() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    let id = new_id();
    let input = TransactionInput { id: Some(id.clone()), ..expense(&card.id, 500, &food, "2025-03-05") };
    transactions::create(&mut f.db.conn, &ws, &input).unwrap();
    transactions::create(&mut f.db.conn, &ws, &input).unwrap();
    assert_eq!(f.balance(&ws, &card.id), -500);
    // the same id cannot be reused from another workspace
    let fam_card = f.account(&f.family.id.clone(), "Общая", "EUR", 0);
    let fam_food = f.category(&f.family.id, "Продукты");
    let reuse = TransactionInput { id: Some(id), ..expense(&fam_card.id, 500, &fam_food, "2025-03-05") };
    assert!(transactions::create(&mut f.db.conn, &f.family.id.clone(), &reuse).is_err());
}

#[test]
fn credit_card_debt_is_not_own_money() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let debit = f.account(&ws, "Карта", "EUR", 50_000);
    let credit = f.account(&ws, "Кредитка", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    transactions::create(
        &mut f.db.conn,
        &ws,
        &expense(&credit.id, 20_000, &food, &format_date(crate::domain::dates::today())),
    )
    .unwrap();
    assert_eq!(f.balance(&ws, &credit.id), -20_000);
    let today = format_date(crate::domain::dates::today());
    let d = analytics::dashboard(&f.db.conn, &ws, &today, &today).unwrap();
    assert_eq!(d.total_balance, 30_000);
    assert_eq!(d.credit_debt, 20_000);
    let acc = accounts::get(&f.db.conn, &ws, &credit.id).unwrap();
    assert_eq!(acc.credit_limit, Some(100_000));
    let _ = debit;
}

#[test]
fn budget_limits_warn_at_80_percent_and_flag_overspending() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    let fun = f.category(&ws, "Развлечения");
    budgets::set_total(&mut f.db.conn, &ws, "2025-03", Some(100_000)).unwrap();
    budgets::set_limit(&mut f.db.conn, &ws, "2025-03", &LimitInput { category_id: food.clone(), limit: 50_000 })
        .unwrap();
    budgets::set_limit(&mut f.db.conn, &ws, "2025-03", &LimitInput { category_id: fun.clone(), limit: 15_000 })
        .unwrap();
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 41_000, &food, "2025-03-10")).unwrap();
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 16_000, &fun, "2025-03-11")).unwrap();
    // spending in other months does not count
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 99_000, &food, "2025-04-01")).unwrap();

    let b = budgets::get(&f.db.conn, &ws, "2025-03").unwrap();
    let food_limit = b.limits.iter().find(|l| l.category_id == food).unwrap();
    assert_eq!((food_limit.spent, food_limit.remaining, food_limit.status), (41_000, 9_000, LimitStatus::Warning));
    assert_eq!(food_limit.percent_bp, 8_200);
    let fun_limit = b.limits.iter().find(|l| l.category_id == fun).unwrap();
    assert_eq!(fun_limit.status, LimitStatus::Over);
    assert_eq!(b.total_spent, 57_000);
    assert_eq!(b.total_remaining, Some(43_000));

    let april = budgets::copy_previous(&mut f.db.conn, &ws, "2025-04").unwrap();
    assert_eq!(april.total_limit, Some(100_000));
    assert_eq!(april.limits.len(), 2);
    assert_eq!(april.limits.iter().find(|l| l.category_id == food).unwrap().status, LimitStatus::Over);
    assert!(matches!(budgets::copy_previous(&mut f.db.conn, &ws, "2025-04"), Err(AppError::Conflict(_))));
}

#[test]
fn subcategory_spending_counts_towards_parent_limit() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let car = f.category(&ws, "Автомобиль");
    let fuel = categories::create(
        &mut f.db.conn,
        &ws,
        &categories::CategoryInput {
            id: None,
            name: "Бензин".into(),
            kind: "expense".into(),
            parent_id: Some(car.clone()),
            icon: "fuel".into(),
            color: "#2563eb".into(),
        },
    )
    .unwrap();
    budgets::set_limit(&mut f.db.conn, &ws, "2025-03", &LimitInput { category_id: car.clone(), limit: 20_000 })
        .unwrap();
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 6_000, &fuel.id, "2025-03-03")).unwrap();
    let b = budgets::get(&f.db.conn, &ws, "2025-03").unwrap();
    assert_eq!(b.limits[0].spent, 6_000);
    let a = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap();
    assert_eq!(a.expense_by_category[0].category_id.as_deref(), Some(car.as_str()));
}

#[test]
fn recurring_payments_create_pending_operations_once() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 100_000);
    let housing = f.category(&ws, "Жильё");
    let rule = recurring::create(
        &mut f.db.conn,
        &ws,
        &RecurringInput {
            id: None,
            name: "Аренда".into(),
            kind: "expense".into(),
            amount: 80_000,
            account_id: card.id.clone(),
            category_id: housing,
            member_id: None,
            comment: None,
            interval_unit: "month".into(),
            interval_count: 1,
            start_date: "2025-01-31".into(),
            end_date: None,
        },
    )
    .unwrap();
    let until = parse_date("2025-03-31", "date").unwrap();
    let report = recurring::generate_due(&mut f.db.conn, &ws, until).unwrap();
    assert_eq!(report.created, 3);
    assert!(report.failed_rules.is_empty());
    // running again creates nothing new
    assert_eq!(recurring::generate_due(&mut f.db.conn, &ws, until).unwrap().created, 0);
    // pending operations do not touch the balance
    assert_eq!(f.balance(&ws, &card.id), 100_000);
    let pending = transactions::list(
        &f.db.conn,
        &ws,
        &TransactionFilter { status: Some("pending".into()), sort: Some("date_asc".into()), ..Default::default() },
    )
    .unwrap()
    .items;
    assert_eq!(pending.iter().map(|t| t.date.as_str()).collect::<Vec<_>>(), ["2025-01-31", "2025-02-28", "2025-03-31"]);

    // confirm the first, skip the second
    let first = &pending[0];
    let mut confirm = expense(&card.id, 80_000, first.category_id.as_deref().unwrap(), &first.date);
    confirm.comment = Some("Аренда".into());
    transactions::confirm(&mut f.db.conn, &ws, &first.id, &confirm).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 20_000);
    assert!(transactions::confirm(&mut f.db.conn, &ws, &first.id, &confirm).is_err());
    transactions::delete(&mut f.db.conn, &ws, &pending[1].id).unwrap();
    assert_eq!(recurring::generate_due(&mut f.db.conn, &ws, until).unwrap().created, 0);
    assert_eq!(recurring::get(&f.db.conn, &ws, &rule.id).unwrap().next_date, "2025-04-30");
}

#[test]
fn rule_that_ended_during_a_pause_finishes_instead_of_billing_the_pause() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 100_000);
    let housing = f.category(&ws, "Жильё");
    let rule = recurring::create(
        &mut f.db.conn,
        &ws,
        &RecurringInput {
            id: None,
            name: "Абонемент".into(),
            kind: "expense".into(),
            amount: 3_000,
            account_id: card.id.clone(),
            category_id: housing,
            member_id: None,
            comment: None,
            interval_unit: "month".into(),
            interval_count: 1,
            start_date: "2025-01-15".into(),
            end_date: Some("2025-06-30".into()),
        },
    )
    .unwrap();
    recurring::generate_due(&mut f.db.conn, &ws, parse_date("2025-03-20", "date").unwrap()).unwrap();
    recurring::set_paused(&mut f.db.conn, &ws, &rule.id, true).unwrap();
    // resumed long after the end date (today is past 2025)
    let resumed = recurring::set_paused(&mut f.db.conn, &ws, &rule.id, false).unwrap();
    assert_eq!(resumed.status, "finished");
    assert_eq!(
        recurring::generate_due(&mut f.db.conn, &ws, parse_date("2026-01-01", "date").unwrap()).unwrap().created,
        0
    );
}

#[test]
fn goal_contributions_are_not_expenses() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 100_000);
    let savings = f.account(&ws, "Накопительный", "EUR", 0);
    let goal = goals::create(
        &mut f.db.conn,
        &ws,
        &GoalInput {
            id: None,
            name: "Отпуск".into(),
            target: 120_000,
            currency: "EUR".into(),
            target_date: Some("2099-12-31".into()),
            account_id: Some(savings.id.clone()),
            description: None,
            icon: "plane".into(),
            color: "#06b6d4".into(),
        },
    )
    .unwrap();
    // earmark only
    goals::contribute(
        &mut f.db.conn,
        &ws,
        &goal.id,
        &ContributionInput { id: None, amount: 10_000, date: "2025-03-01".into(), account_id: None, comment: None },
    )
    .unwrap();
    // backed by a real transfer
    let g = goals::contribute(
        &mut f.db.conn,
        &ws,
        &goal.id,
        &ContributionInput {
            id: None,
            amount: 20_000,
            date: "2025-03-02".into(),
            account_id: Some(card.id.clone()),
            comment: None,
        },
    )
    .unwrap();
    assert_eq!(g.progress.current, 30_000);
    assert_eq!(g.progress.remaining, 90_000);
    assert_eq!(g.progress.percent_bp, 2_500);
    assert_eq!(f.balance(&ws, &card.id), 80_000);
    assert_eq!(f.balance(&ws, &savings.id), 20_000);
    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(totals, analytics::Totals::default());

    // deleting the contribution returns the transferred money
    let list = goals::contributions(&f.db.conn, &ws, &goal.id).unwrap();
    let backed = list.iter().find(|c| c.transaction_id.is_some()).unwrap();
    // editing the backing transfer moves the goal progress with it
    let tx_id = backed.transaction_id.clone().unwrap();
    let mut edited = transfer(&card.id, &savings.id, 15_000, None, 0);
    edited.date = "2025-03-02".into();
    transactions::update(&mut f.db.conn, &ws, &tx_id, &edited).unwrap();
    assert_eq!(goals::get(&f.db.conn, &ws, &goal.id).unwrap().progress.current, 25_000);
    // turning it into something else would orphan the contribution
    let as_expense = expense(&card.id, 15_000, &f.category(&ws, "Продукты"), "2025-03-02");
    assert!(matches!(
        transactions::update(&mut f.db.conn, &ws, &tx_id, &as_expense),
        Err(AppError::Conflict("goal_transfer"))
    ));

    goals::delete_contribution(&mut f.db.conn, &ws, &backed.id).unwrap();
    assert_eq!(f.balance(&ws, &card.id), 100_000);
    assert_eq!(goals::get(&f.db.conn, &ws, &goal.id).unwrap().progress.current, 10_000);
}

#[test]
fn deleted_workspace_disappears_but_the_last_one_stays() {
    let mut f = fixture();
    let family = f.family.id.clone();
    let card = f.account(&family, "Карта", "EUR", 1_000);
    let food = f.category(&family, "Продукты");
    assert!(transactions::create(&mut f.db.conn, &family, &expense(&card.id, 100, &food, "2025-03-01")).is_ok());
    settings::write(&f.db.conn, "active_workspace_id", &family).unwrap();
    workspaces::delete(&mut f.db.conn, &family).unwrap();
    let left = workspaces::list(&f.db.conn).unwrap();
    assert_eq!(left.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), [f.personal.id.as_str()]);
    // no new records go into it, and the app no longer opens it
    assert!(transactions::create(&mut f.db.conn, &family, &expense(&card.id, 100, &food, "2025-03-02")).is_err());
    assert_eq!(settings::get(&f.db.conn).unwrap().active_workspace_id, None);
    assert!(matches!(
        workspaces::delete(&mut f.db.conn, &f.personal.id.clone()),
        Err(AppError::Conflict("last_workspace"))
    ));
    assert!(backup::integrity(&f.db.conn).unwrap().ok);
}

#[test]
fn personal_and_family_data_are_isolated() {
    let mut f = fixture();
    let personal = f.personal.id.clone();
    let family = f.family.id.clone();
    let mine = f.account(&personal, "Моя карта", "EUR", 1_000);
    let shared = f.account(&family, "Общая карта", "EUR", 5_000);
    let food_personal = f.category(&personal, "Продукты");
    let food_family = f.category(&family, "Продукты");
    assert_ne!(food_personal, food_family);

    // the family workspace cannot touch a personal account or category
    assert!(
        transactions::create(&mut f.db.conn, &family, &expense(&mine.id, 100, &food_family, "2025-03-01")).is_err()
    );
    assert!(
        transactions::create(&mut f.db.conn, &family, &expense(&shared.id, 100, &food_personal, "2025-03-01")).is_err()
    );
    assert!(transactions::create(&mut f.db.conn, &family, &transfer(&shared.id, &mine.id, 100, None, 0)).is_err());
    assert!(
        accounts::update(
            &mut f.db.conn,
            &family,
            &mine.id,
            &accounts::AccountInput {
                id: None,
                name: "x".into(),
                kind: "cash".into(),
                currency: "EUR".into(),
                initial_balance: 0,
                credit_limit: None,
                icon: "wallet".into(),
                color: "#000000".into(),
            }
        )
        .is_err()
    );

    transactions::create(&mut f.db.conn, &family, &expense(&shared.id, 700, &food_family, "2025-03-01")).unwrap();
    assert_eq!(accounts::list(&f.db.conn, &personal).unwrap().len(), 1);
    assert_eq!(accounts::list(&f.db.conn, &family).unwrap().len(), 1);
    let personal_ops = transactions::list(&f.db.conn, &personal, &TransactionFilter::default()).unwrap();
    assert_eq!(personal_ops.total, 0);
    let family_totals = analytics::analytics(&f.db.conn, &family, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(family_totals.expense, 700);
    let personal_totals =
        analytics::analytics(&f.db.conn, &personal, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(personal_totals.expense, 0);
}

#[test]
fn multicurrency_uses_historical_rates() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let usd = f.account(&ws, "USD", "USD", 0);
    let food = f.category(&ws, "Продукты");
    // no rate yet → clear error instead of a silent wrong sum
    let err = transactions::create(&mut f.db.conn, &ws, &expense(&usd.id, 10_000, &food, "2025-03-05")).unwrap_err();
    assert!(matches!(err, AppError::RateMissing(c) if c == "USD"));

    let mut with_rate = expense(&usd.id, 10_000, &food, "2025-03-05");
    with_rate.rate = Some("0,92".into());
    let t = transactions::create(&mut f.db.conn, &ws, &with_rate).unwrap();
    assert_eq!(t.base_amount, Some(-9_200));
    // the typed rate is remembered for later operations
    assert_eq!(rates::list(&f.db.conn, &ws).unwrap().len(), 1);
    let later = transactions::create(&mut f.db.conn, &ws, &expense(&usd.id, 5_000, &food, "2025-03-20")).unwrap();
    assert_eq!(later.base_amount, Some(-4_600));

    // a new rate does not rewrite history
    rates::upsert(
        &mut f.db.conn,
        &ws,
        &rates::RateInput { currency: "USD".into(), rate: "0.5".into(), rate_date: "2025-03-05".into() },
    )
    .unwrap();
    assert_eq!(transactions::get(&f.db.conn, &ws, &t.id).unwrap().base_amount, Some(-9_200));
    let totals = analytics::analytics(&f.db.conn, &ws, &month("2025-03-01", "2025-03-31")).unwrap().totals;
    assert_eq!(totals.expense, 13_800);
    let usd_only = analytics::analytics(
        &f.db.conn,
        &ws,
        &AnalyticsFilter { currency: Some("USD".into()), ..month("2025-03-01", "2025-03-31") },
    )
    .unwrap();
    assert_eq!(usd_only.totals.expense, 13_800);
}

#[test]
fn balance_in_base_currency_warns_about_missing_rates() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    f.account(&ws, "Евро", "EUR", 10_000);
    f.account(&ws, "Франки", "CHF", 5_000);
    let today = format_date(crate::domain::dates::today());
    let d = analytics::dashboard(&f.db.conn, &ws, &today, &today).unwrap();
    assert_eq!(d.total_balance, 10_000);
    assert_eq!(d.missing_rates, vec!["CHF".to_string()]);
    rates::upsert(
        &mut f.db.conn,
        &ws,
        &rates::RateInput { currency: "CHF".into(), rate: "1.05".into(), rate_date: today.clone() },
    )
    .unwrap();
    let d = analytics::dashboard(&f.db.conn, &ws, &today, &today).unwrap();
    assert_eq!(d.total_balance, 15_250);
    assert!(d.missing_rates.is_empty());
}

#[test]
fn category_in_use_needs_reassignment() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    let other = f.category(&ws, "Прочее");
    let t = transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 100, &food, "2025-03-01")).unwrap();
    assert!(matches!(categories::delete(&mut f.db.conn, &ws, &food, None), Err(AppError::Conflict("category_in_use"))));
    let salary = f.category(&ws, "Зарплата");
    assert!(categories::delete(&mut f.db.conn, &ws, &food, Some(&salary)).is_err());
    categories::delete(&mut f.db.conn, &ws, &food, Some(&other)).unwrap();
    assert_eq!(transactions::get(&f.db.conn, &ws, &t.id).unwrap().category_id.as_deref(), Some(other.as_str()));
    // an unused category is deleted directly
    let kids = f.category(&ws, "Дети");
    categories::delete(&mut f.db.conn, &ws, &kids, None).unwrap();
}

#[test]
fn used_account_can_only_be_archived() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let empty = f.account(&ws, "Пустой", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 100, &food, "2025-03-01")).unwrap();
    assert!(matches!(accounts::delete(&mut f.db.conn, &ws, &card.id), Err(AppError::Conflict("account_in_use"))));
    accounts::set_active(&mut f.db.conn, &ws, &card.id, false).unwrap();
    // an archived account takes no new operations
    assert!(transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 100, &food, "2025-03-01")).is_err());
    accounts::delete(&mut f.db.conn, &ws, &empty.id).unwrap();
    assert_eq!(accounts::list(&f.db.conn, &ws).unwrap().len(), 1);
}

#[test]
fn base_currency_is_locked_once_there_is_history() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let update = workspaces::WorkspaceUpdate { name: "Мой".into(), base_currency: "USD".into() };
    workspaces::update(&mut f.db.conn, &ws, &update).unwrap();
    let card = f.account(&ws, "Карта", "USD", 0);
    let food = f.category(&ws, "Продукты");
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 100, &food, "2025-03-01")).unwrap();
    let back = workspaces::WorkspaceUpdate { name: "Мой".into(), base_currency: "EUR".into() };
    assert!(matches!(workspaces::update(&mut f.db.conn, &ws, &back), Err(AppError::Conflict(_))));
}

#[test]
fn changes_are_tracked_for_future_sync() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let (version, dirty): (i64, i64) =
        f.db.conn
            .query_row(
                "SELECT local_version, dirty FROM sync_metadata WHERE entity = 'account' AND entity_id = ?1",
                [&card.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
    assert_eq!((version, dirty), (1, 1));
    accounts::set_active(&mut f.db.conn, &ws, &card.id, false).unwrap();
    let version: i64 =
        f.db.conn
            .query_row("SELECT local_version FROM sync_metadata WHERE entity_id = ?1", [&card.id], |r| r.get(0))
            .unwrap();
    assert_eq!(version, 2);
}

#[test]
fn data_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fb.db");
    let account_id;
    {
        let mut db = crate::db::Database::open(&path).unwrap();
        let ws = setup::complete_onboarding(
            &mut db.conn,
            &setup::OnboardingInput {
                user_name: "Иван".into(),
                personal_name: "Личный".into(),
                base_currency: "RUB".into(),
                family_name: None,
            },
        )
        .unwrap();
        account_id = accounts::create(
            &mut db.conn,
            &ws[0].id,
            &accounts::AccountInput {
                id: None,
                name: "Наличные".into(),
                kind: "cash".into(),
                currency: "RUB".into(),
                initial_balance: 150_000,
                credit_limit: None,
                icon: "wallet".into(),
                color: "#16a34a".into(),
            },
        )
        .unwrap()
        .id;
    }
    let db = crate::db::Database::open(&path).unwrap();
    let ws = workspaces::list(&db.conn).unwrap();
    assert_eq!(ws.len(), 1);
    assert_eq!(accounts::get(&db.conn, &ws[0].id, &account_id).unwrap().balance, 150_000);
}

#[test]
fn backup_and_restore_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let backups = dir.path().join("backups");
    let mut db = crate::db::Database::open(&dir.path().join("fb.db")).unwrap();
    let ws = setup::complete_onboarding(
        &mut db.conn,
        &setup::OnboardingInput {
            user_name: "Иван".into(),
            personal_name: "Личный".into(),
            base_currency: "EUR".into(),
            family_name: None,
        },
    )
    .unwrap()
    .remove(0);
    let card = accounts::create(
        &mut db.conn,
        &ws.id,
        &accounts::AccountInput {
            id: None,
            name: "Карта".into(),
            kind: "debit_card".into(),
            currency: "EUR".into(),
            initial_balance: 1_000,
            credit_limit: None,
            icon: "wallet".into(),
            color: "#16a34a".into(),
        },
    )
    .unwrap();
    let name = backup::manual_backup(&db.conn, &backups).unwrap();
    let info = backup::verify_file(&backup::resolve(&backups, &name).unwrap()).unwrap();
    assert_eq!(info.workspaces, 1);

    // changes after the backup
    let food: String = db
        .conn
        .query_row("SELECT id FROM categories WHERE workspace_id = ?1 AND name = 'Продукты'", [&ws.id], |r| {
            r.get(0)
        })
        .unwrap();
    transactions::create(&mut db.conn, &ws.id, &expense(&card.id, 400, &food, "2025-03-01")).unwrap();
    assert_eq!(accounts::get(&db.conn, &ws.id, &card.id).unwrap().balance, 600);

    let source = backup::resolve(&backups, &name).unwrap();
    crate::app::settings::write(&db.conn, "backup_dir", &"D:/Backups").unwrap();
    let safety = backup::restore_from(&mut db, &source, &backups).unwrap();
    assert_eq!(accounts::get(&db.conn, &ws.id, &card.id).unwrap().balance, 1_000);
    // device settings are not rolled back with the data
    let folder: Option<String> = crate::app::settings::read(&db.conn, "backup_dir").unwrap();
    assert_eq!(folder.as_deref(), Some("D:/Backups"));
    let last: Option<i64> = crate::app::settings::read(&db.conn, "last_backup_at").unwrap();
    assert!(last.is_some());
    // the state before the restore is kept and can be restored back
    let safety_path = backup::resolve(&backups, &safety).unwrap();
    assert_eq!(backup::verify_file(&safety_path).unwrap().transactions, 1);
    backup::restore_from(&mut db, &safety_path, &backups).unwrap();
    assert_eq!(accounts::get(&db.conn, &ws.id, &card.id).unwrap().balance, 600);
    assert!(backup::integrity(&db.conn).unwrap().ok);
}

#[test]
fn restore_rejects_garbage_and_path_tricks() {
    let dir = tempfile::tempdir().unwrap();
    let junk = dir.path().join("junk.fbbak");
    std::fs::write(&junk, b"not a database").unwrap();
    assert!(backup::verify_file(&junk).is_err());
    assert!(backup::resolve(dir.path(), "..\\fb.db").is_err());
    assert!(backup::resolve(dir.path(), "C:\\Windows\\x.fbbak").is_err());
    let mut db = crate::db::Database::open_in_memory().unwrap();
    assert!(backup::restore_from(&mut db, &junk, dir.path()).is_err());
}

#[test]
fn failed_restore_puts_the_current_data_back() {
    let dir = tempfile::tempdir().unwrap();
    // A copy that opens fine but breaks a ledger rule: an operation without entries.
    let broken = dir.path().join("broken.fbbak");
    {
        let other = fixture();
        let ws = &other.personal.id;
        let user = current_user(&other.db.conn).unwrap();
        other
            .db
            .conn
            .execute(
                "INSERT INTO transactions (id, workspace_id, kind, occurred_on, created_by, created_at, updated_at)
                 VALUES (?1, ?2, 'expense', '2025-03-01', ?3, 0, 0)",
                params![new_id(), ws, user],
            )
            .unwrap();
        other.db.conn.backup(rusqlite::MAIN_DB, &broken, None::<fn(rusqlite::backup::Progress)>).unwrap();
    }
    assert!(backup::verify_file(&broken).is_ok());

    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 1_000);
    let backups = dir.path().join("backups");
    assert!(matches!(backup::restore_from(&mut f.db, &broken, &backups), Err(AppError::Integrity)));
    // the live data is the one from before the restore attempt
    assert_eq!(f.balance(&ws, &card.id), 1_000);
    assert!(backup::integrity(&f.db.conn).unwrap().ok);
}

#[test]
fn automatic_backup_runs_once_a_day_and_prunes() {
    let mut f = fixture();
    let dir = tempfile::tempdir().unwrap();
    assert!(backup::auto_backup_if_due(&f.db.conn, dir.path()).unwrap().is_some());
    assert!(backup::auto_backup_if_due(&f.db.conn, dir.path()).unwrap().is_none());
    settings::update(&mut f.db.conn, &settings::SettingsUpdate { auto_backup: Some(false), ..Default::default() })
        .unwrap();
    settings::write(&f.db.conn, "last_auto_backup_at", &0_i64).unwrap();
    assert!(backup::auto_backup_if_due(&f.db.conn, dir.path()).unwrap().is_none());
}

#[test]
fn sidebar_order_is_saved_and_checked() {
    let mut f = fixture();
    assert!(settings::get(&f.db.conn).unwrap().nav_order.is_empty());
    let order: Vec<String> = ["goals", "dashboard", "settings", "categories"].map(String::from).to_vec();
    let saved = settings::update(
        &mut f.db.conn,
        &settings::SettingsUpdate { nav_order: Some(order.clone()), ..Default::default() },
    )
    .unwrap();
    assert_eq!(saved.nav_order, order);
    for bad in [vec!["dashboard", "dashboard"], vec!["dashboard", "<script>"]] {
        let bad = bad.into_iter().map(String::from).collect();
        assert!(
            settings::update(&mut f.db.conn, &settings::SettingsUpdate { nav_order: Some(bad), ..Default::default() })
                .is_err()
        );
    }
    // an empty list is the reset to the default order
    let reset = settings::update(
        &mut f.db.conn,
        &settings::SettingsUpdate { nav_order: Some(Vec::new()), ..Default::default() },
    )
    .unwrap();
    assert!(reset.nav_order.is_empty());
}

#[test]
fn csv_export_contains_operations() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 0);
    let food = f.category(&ws, "Продукты");
    let mut t = expense(&card.id, 1_250, &food, "2025-03-01");
    t.comment = Some("=HACK()".into());
    transactions::create(&mut f.db.conn, &ws, &t).unwrap();
    let csv = export::transactions_csv(&f.db.conn, &ws, &TransactionFilter::default()).unwrap();
    assert!(csv.contains("2025-03-01;Расход;Карта;-12,50;EUR"));
    assert!(csv.contains("'=HACK()"));
    let json = export::workspace_json(&f.db.conn, &ws).unwrap();
    assert_eq!(json["data"]["transactions"].as_array().unwrap().len(), 1);
}

#[test]
fn month_end_forecast_uses_the_30_day_pace() {
    let mut f = fixture();
    let ws = f.personal.id.clone();
    let card = f.account(&ws, "Карта", "EUR", 100_000);
    let food = f.category(&ws, "Продукты");
    let today = crate::domain::dates::today();
    transactions::create(&mut f.db.conn, &ws, &expense(&card.id, 30_000, &food, &format_date(today))).unwrap();
    let day = format_date(today);
    let d = analytics::dashboard(&f.db.conn, &ws, &day, &day).unwrap();
    // 300.00 over 30 days = 10.00 a day, for every day left in the month
    let left = (crate::domain::dates::month_end(today) - today).num_days();
    assert_eq!(d.forecast_end_of_month, 70_000 - 1_000 * left);
}
