use super::St;
use crate::app::accounts::{self, Account, AccountInput};
use crate::app::categories::{self, Category, CategoryInput};
use crate::app::rates::{self, ExchangeRate, RateInput};
use crate::app::transactions::{self, Transaction, TransactionFilter, TransactionInput, TransactionPage};
use crate::domain::dates::{format_date, parse_date};
use crate::error::AppResult;

#[tauri::command]
pub async fn list_accounts(state: St<'_>, workspace_id: String) -> AppResult<Vec<Account>> {
    state.with_db(|db| accounts::list(&db.conn, &workspace_id))
}

#[tauri::command]
pub async fn create_account(state: St<'_>, workspace_id: String, input: AccountInput) -> AppResult<Account> {
    state.with_db(|db| accounts::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_account(
    state: St<'_>,
    workspace_id: String,
    id: String,
    input: AccountInput,
) -> AppResult<Account> {
    state.with_db(|db| accounts::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn set_account_active(state: St<'_>, workspace_id: String, id: String, active: bool) -> AppResult<Account> {
    state.with_db(|db| accounts::set_active(&mut db.conn, &workspace_id, &id, active))
}

#[tauri::command]
pub async fn delete_account(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| accounts::delete(&mut db.conn, &workspace_id, &id))
}

#[tauri::command]
pub async fn list_categories(state: St<'_>, workspace_id: String) -> AppResult<Vec<Category>> {
    state.with_db(|db| categories::list(&db.conn, &workspace_id))
}

#[tauri::command]
pub async fn create_category(state: St<'_>, workspace_id: String, input: CategoryInput) -> AppResult<Category> {
    state.with_db(|db| categories::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_category(
    state: St<'_>,
    workspace_id: String,
    id: String,
    input: CategoryInput,
) -> AppResult<Category> {
    state.with_db(|db| categories::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn set_category_hidden(state: St<'_>, workspace_id: String, id: String, hidden: bool) -> AppResult<Category> {
    state.with_db(|db| categories::set_hidden(&mut db.conn, &workspace_id, &id, hidden))
}

#[tauri::command]
pub async fn delete_category(
    state: St<'_>,
    workspace_id: String,
    id: String,
    reassign_to: Option<String>,
) -> AppResult<()> {
    state.with_db(|db| categories::delete(&mut db.conn, &workspace_id, &id, reassign_to.as_deref()))
}

#[tauri::command]
pub async fn list_rates(state: St<'_>, workspace_id: String) -> AppResult<Vec<ExchangeRate>> {
    state.with_db(|db| rates::list(&db.conn, &workspace_id))
}

/// Rate `currency → base` valid on `date`, if one is known.
#[tauri::command]
pub async fn find_rate(
    state: St<'_>,
    workspace_id: String,
    currency: String,
    date: String,
) -> AppResult<Option<String>> {
    let date = format_date(parse_date(&date, "date")?);
    state.with_db(|db| Ok(rates::find(&db.conn, &workspace_id, &currency, &date)?.map(|c| c.rate.to_string())))
}

#[tauri::command]
pub async fn upsert_rate(state: St<'_>, workspace_id: String, input: RateInput) -> AppResult<ExchangeRate> {
    state.with_db(|db| rates::upsert(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn delete_rate(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| rates::delete(&mut db.conn, &workspace_id, &id))
}

#[tauri::command]
pub async fn list_transactions(
    state: St<'_>,
    workspace_id: String,
    filter: TransactionFilter,
) -> AppResult<TransactionPage> {
    state.with_db(|db| transactions::list(&db.conn, &workspace_id, &filter))
}

#[tauri::command]
pub async fn create_transaction(
    state: St<'_>,
    workspace_id: String,
    input: TransactionInput,
) -> AppResult<Transaction> {
    state.with_db(|db| transactions::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_transaction(
    state: St<'_>,
    workspace_id: String,
    id: String,
    input: TransactionInput,
) -> AppResult<Transaction> {
    state.with_db(|db| transactions::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn confirm_transaction(
    state: St<'_>,
    workspace_id: String,
    id: String,
    input: TransactionInput,
) -> AppResult<Transaction> {
    state.with_db(|db| transactions::confirm(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn delete_transaction(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| transactions::delete(&mut db.conn, &workspace_id, &id))
}

#[tauri::command]
pub async fn restore_transaction(state: St<'_>, workspace_id: String, id: String) -> AppResult<Transaction> {
    state.with_db(|db| transactions::restore(&mut db.conn, &workspace_id, &id))
}
