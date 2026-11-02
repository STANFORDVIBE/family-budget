pub mod app;
mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod state;

use std::time::Duration;

use tauri::Manager;

use crate::state::AppState;

/// Where the data lives. Debug builds honour `FAMILY_BUDGET_DATA_DIR` so manual and automated
/// testing never touch real data; release builds ignore it.
fn data_dir(app: &tauri::App) -> tauri::Result<std::path::PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("FAMILY_BUDGET_DATA_DIR") {
        return Ok(dir.into());
    }
    app.path().app_data_dir()
}

fn is_test_instance() -> bool {
    cfg!(debug_assertions) && std::env::var_os("FAMILY_BUDGET_DATA_DIR").is_some()
}

/// Daily automatic backup: checked at start and then every hour.
fn start_auto_backup(handle: &tauri::AppHandle) {
    let handle = handle.clone();
    std::thread::spawn(move || {
        loop {
            let state = handle.state::<AppState>();
            // Errors are not fatal here: the next check retries, and the UI shows the last backup time.
            let _ = state.with_db(|db| {
                let dir = state.backup_dir(db)?;
                app::backup::auto_backup_if_due(&db.conn, &dir)
            });
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // A test copy on its own data dir must not grab the single-instance lock of the real app.
    if !is_test_instance() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = data_dir(app)?;
            app.manage(AppState::new(data_dir));
            start_auto_backup(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::get_bootstrap,
            commands::workspace::complete_onboarding,
            commands::workspace::rename_user,
            commands::workspace::create_workspace,
            commands::workspace::update_workspace,
            commands::workspace::list_members,
            commands::workspace::create_member,
            commands::workspace::update_member,
            commands::workspace::update_settings,
            commands::workspace::get_form_memory,
            commands::finance::list_accounts,
            commands::finance::create_account,
            commands::finance::update_account,
            commands::finance::set_account_active,
            commands::finance::delete_account,
            commands::finance::list_categories,
            commands::finance::create_category,
            commands::finance::update_category,
            commands::finance::set_category_hidden,
            commands::finance::delete_category,
            commands::finance::list_rates,
            commands::finance::find_rate,
            commands::finance::upsert_rate,
            commands::finance::delete_rate,
            commands::finance::list_transactions,
            commands::finance::create_transaction,
            commands::finance::update_transaction,
            commands::finance::confirm_transaction,
            commands::finance::delete_transaction,
            commands::finance::restore_transaction,
            commands::planning::get_budget,
            commands::planning::set_budget_total,
            commands::planning::set_budget_limit,
            commands::planning::remove_budget_limit,
            commands::planning::copy_previous_budget,
            commands::planning::list_recurring,
            commands::planning::create_recurring,
            commands::planning::update_recurring,
            commands::planning::set_recurring_paused,
            commands::planning::delete_recurring,
            commands::planning::generate_recurring,
            commands::planning::list_goals,
            commands::planning::create_goal,
            commands::planning::update_goal,
            commands::planning::set_goal_status,
            commands::planning::delete_goal,
            commands::planning::list_contributions,
            commands::planning::contribute_goal,
            commands::planning::delete_contribution,
            commands::reports::get_dashboard,
            commands::reports::get_analytics,
            commands::reports::list_audit,
            commands::data::get_backup_status,
            commands::data::create_backup,
            commands::data::restore_backup,
            commands::data::restore_backup_from_file,
            commands::data::recover_from_file,
            commands::data::choose_backup_folder,
            commands::data::reset_backup_folder,
            commands::data::open_backup_folder,
            commands::data::check_integrity,
            commands::data::export_workspace,
            commands::data::export_transactions_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
