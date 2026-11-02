use super::St;
use crate::app::budgets::{self, BudgetView, LimitInput};
use crate::app::goals::{self, Contribution, ContributionInput, Goal, GoalInput};
use crate::app::recurring::{self, GenerationReport, RecurringInput, RecurringRule};
use crate::domain::dates::today;
use crate::error::AppResult;

#[tauri::command]
pub async fn get_budget(state: St<'_>, workspace_id: String, month: String) -> AppResult<BudgetView> {
    state.with_db(|db| budgets::get(&db.conn, &workspace_id, &month))
}

#[tauri::command]
pub async fn set_budget_total(
    state: St<'_>,
    workspace_id: String,
    month: String,
    limit: Option<i64>,
) -> AppResult<BudgetView> {
    state.with_db(|db| budgets::set_total(&mut db.conn, &workspace_id, &month, limit))
}

#[tauri::command]
pub async fn set_budget_limit(
    state: St<'_>,
    workspace_id: String,
    month: String,
    input: LimitInput,
) -> AppResult<BudgetView> {
    state.with_db(|db| budgets::set_limit(&mut db.conn, &workspace_id, &month, &input))
}

#[tauri::command]
pub async fn remove_budget_limit(
    state: St<'_>,
    workspace_id: String,
    month: String,
    category_id: String,
) -> AppResult<BudgetView> {
    state.with_db(|db| budgets::remove_limit(&mut db.conn, &workspace_id, &month, &category_id))
}

#[tauri::command]
pub async fn copy_previous_budget(state: St<'_>, workspace_id: String, month: String) -> AppResult<BudgetView> {
    state.with_db(|db| budgets::copy_previous(&mut db.conn, &workspace_id, &month))
}

#[tauri::command]
pub async fn list_recurring(state: St<'_>, workspace_id: String) -> AppResult<Vec<RecurringRule>> {
    state.with_db(|db| recurring::list(&db.conn, &workspace_id))
}

#[tauri::command]
pub async fn create_recurring(state: St<'_>, workspace_id: String, input: RecurringInput) -> AppResult<RecurringRule> {
    state.with_db(|db| recurring::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_recurring(
    state: St<'_>,
    workspace_id: String,
    id: String,
    input: RecurringInput,
) -> AppResult<RecurringRule> {
    state.with_db(|db| recurring::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn set_recurring_paused(
    state: St<'_>,
    workspace_id: String,
    id: String,
    paused: bool,
) -> AppResult<RecurringRule> {
    state.with_db(|db| recurring::set_paused(&mut db.conn, &workspace_id, &id, paused))
}

#[tauri::command]
pub async fn delete_recurring(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| recurring::delete(&mut db.conn, &workspace_id, &id))
}

/// Turns due occurrences into pending operations. Idempotent; the UI calls it on start and daily.
#[tauri::command]
pub async fn generate_recurring(state: St<'_>, workspace_id: String) -> AppResult<GenerationReport> {
    state.with_db(|db| recurring::generate_due(&mut db.conn, &workspace_id, today()))
}

#[tauri::command]
pub async fn list_goals(state: St<'_>, workspace_id: String) -> AppResult<Vec<Goal>> {
    state.with_db(|db| goals::list(&db.conn, &workspace_id))
}

#[tauri::command]
pub async fn create_goal(state: St<'_>, workspace_id: String, input: GoalInput) -> AppResult<Goal> {
    state.with_db(|db| goals::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_goal(state: St<'_>, workspace_id: String, id: String, input: GoalInput) -> AppResult<Goal> {
    state.with_db(|db| goals::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn set_goal_status(state: St<'_>, workspace_id: String, id: String, status: String) -> AppResult<Goal> {
    state.with_db(|db| goals::set_status(&mut db.conn, &workspace_id, &id, &status))
}

#[tauri::command]
pub async fn delete_goal(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| goals::delete(&mut db.conn, &workspace_id, &id))
}

#[tauri::command]
pub async fn list_contributions(state: St<'_>, workspace_id: String, goal_id: String) -> AppResult<Vec<Contribution>> {
    state.with_db(|db| goals::contributions(&db.conn, &workspace_id, &goal_id))
}

#[tauri::command]
pub async fn contribute_goal(
    state: St<'_>,
    workspace_id: String,
    goal_id: String,
    input: ContributionInput,
) -> AppResult<Goal> {
    state.with_db(|db| goals::contribute(&mut db.conn, &workspace_id, &goal_id, &input))
}

#[tauri::command]
pub async fn delete_contribution(state: St<'_>, workspace_id: String, id: String) -> AppResult<()> {
    state.with_db(|db| goals::delete_contribution(&mut db.conn, &workspace_id, &id))
}
