//! Test fixtures: an in-memory database after onboarding.

use super::accounts::{self, Account, AccountInput};
use super::categories;
use super::setup::{self, OnboardingInput};
use super::workspaces::Workspace;
use crate::db::Database;

pub struct Fixture {
    pub db: Database,
    pub personal: Workspace,
    pub family: Workspace,
}

pub fn fixture() -> Fixture {
    let mut db = Database::open_in_memory().unwrap();
    let mut created = setup::complete_onboarding(
        &mut db.conn,
        &OnboardingInput {
            user_name: "Анна".into(),
            personal_name: "Личный".into(),
            base_currency: "EUR".into(),
            family_name: Some("Семья".into()),
        },
    )
    .unwrap();
    let family = created.pop().unwrap();
    let personal = created.pop().unwrap();
    Fixture { db, personal, family }
}

impl Fixture {
    pub fn account(&mut self, workspace_id: &str, name: &str, currency: &str, initial: i64) -> Account {
        let kind = if name.contains("Кредит") { "credit_card" } else { "debit_card" };
        accounts::create(
            &mut self.db.conn,
            workspace_id,
            &AccountInput {
                id: None,
                name: name.into(),
                kind: kind.into(),
                currency: currency.into(),
                initial_balance: initial,
                credit_limit: (kind == "credit_card").then_some(100_000),
                icon: "wallet".into(),
                color: "#14b8a6".into(),
            },
        )
        .unwrap()
    }

    pub fn category(&self, workspace_id: &str, name: &str) -> String {
        categories::list(&self.db.conn, workspace_id)
            .unwrap()
            .into_iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("category {name}"))
            .id
    }

    pub fn balance(&self, workspace_id: &str, account_id: &str) -> i64 {
        accounts::get(&self.db.conn, workspace_id, account_id).unwrap().balance
    }
}
