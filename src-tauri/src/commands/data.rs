//! Backups, restore, integrity checks and exports. Every file location comes from a native
//! dialog or from the backup folder itself, never from a path typed in the WebView.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;

use super::St;
use crate::app::backup::{self, BackupFile, EXTENSION, IntegrityReport};
use crate::app::export;
use crate::app::settings;
use crate::app::transactions::TransactionFilter;
use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub dir: String,
    pub is_custom_dir: bool,
    pub auto_backup: bool,
    pub keep: i64,
    pub last_backup_at: Option<i64>,
    pub files: Vec<BackupFile>,
}

fn status(state: &St<'_>) -> AppResult<BackupStatus> {
    state.with_db(|db| {
        let s = settings::get(&db.conn)?;
        let dir = state.backup_dir(db)?;
        Ok(BackupStatus {
            dir: dir.display().to_string(),
            is_custom_dir: s.backup_dir.is_some(),
            auto_backup: s.auto_backup,
            keep: s.backup_keep,
            last_backup_at: settings::read(&db.conn, "last_backup_at")?,
            files: backup::list(&dir)?,
        })
    })
}

/// Shows a native file dialog. Debug builds started by the end-to-end tests take the answer from
/// `e2e-dialog.txt` in the data folder instead (one answer per dialog); release builds never do.
fn ask(state: &St<'_>, dialog: impl FnOnce() -> Option<FilePath>) -> AppResult<PathBuf> {
    if cfg!(debug_assertions) && std::env::var_os("FAMILY_BUDGET_E2E").is_some() {
        let answer = state.data_dir.join("e2e-dialog.txt");
        if let Ok(text) = std::fs::read_to_string(&answer) {
            let _ = std::fs::remove_file(&answer);
            return Ok(PathBuf::from(text.trim()));
        }
    }
    dialog().ok_or(AppError::Cancelled)?.into_path().map_err(|_| AppError::Cancelled)
}

#[tauri::command]
pub async fn get_backup_status(state: St<'_>) -> AppResult<BackupStatus> {
    status(&state)
}

#[tauri::command]
pub async fn create_backup(state: St<'_>) -> AppResult<String> {
    state.with_db(|db| {
        let dir = state.backup_dir(db)?;
        backup::manual_backup(&db.conn, &dir)
    })
}

/// Restores one of the files listed in the backup folder. Returns the safety copy's name.
#[tauri::command]
pub async fn restore_backup(state: St<'_>, name: String) -> AppResult<String> {
    state.with_db(|db| {
        let dir = state.backup_dir(db)?;
        let source = backup::resolve(&dir, &name)?;
        backup::restore_from(db, &source, &dir)
    })
}

#[tauri::command]
pub async fn restore_backup_from_file(app: AppHandle, state: St<'_>) -> AppResult<String> {
    let source = ask(&state, || {
        app.dialog()
            .file()
            .set_title("Выберите резервную копию")
            .add_filter("Резервная копия Family Budget", &[EXTENSION, "db"])
            .blocking_pick_file()
    })?;
    state.with_db(|db| {
        let dir = state.backup_dir(db)?;
        backup::restore_from(db, &source, &dir)
    })
}

/// Recovery screen: the database could not be opened. The broken file is kept aside, never deleted.
#[tauri::command]
pub async fn recover_from_file(app: AppHandle, state: St<'_>) -> AppResult<()> {
    if state.lock().is_some() {
        return Err(AppError::Conflict("database_is_fine"));
    }
    let source = ask(&state, || {
        app.dialog()
            .file()
            .set_title("Выберите резервную копию")
            .add_filter("Резервная копия Family Budget", &[EXTENSION, "db"])
            .blocking_pick_file()
    })?;
    backup::verify_file(&source)?;
    let db_path = state.db_path();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("{}{suffix}", db_path.display()));
        if file.exists() {
            std::fs::rename(&file, state.data_dir.join(format!("broken-{stamp}.db{suffix}")))?;
        }
    }
    std::fs::copy(&source, &db_path)?;
    state.replace_broken(&db_path)
}

#[tauri::command]
pub async fn choose_backup_folder(app: AppHandle, state: St<'_>) -> AppResult<BackupStatus> {
    let folder = ask(&state, || app.dialog().file().set_title("Папка для резервных копий").blocking_pick_folder())?;
    state.with_db(|db| settings::write(&db.conn, "backup_dir", &folder.display().to_string()))?;
    status(&state)
}

#[tauri::command]
pub async fn reset_backup_folder(state: St<'_>) -> AppResult<BackupStatus> {
    state.with_db(|db| {
        db.conn.execute("DELETE FROM app_settings WHERE key = 'backup_dir'", [])?;
        Ok(())
    })?;
    status(&state)
}

#[tauri::command]
pub async fn open_backup_folder(app: AppHandle, state: St<'_>) -> AppResult<()> {
    let dir = state.with_db(|db| state.backup_dir(db))?;
    std::fs::create_dir_all(&dir)?;
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|_| AppError::Internal)
}

#[tauri::command]
pub async fn check_integrity(state: St<'_>) -> AppResult<IntegrityReport> {
    state.with_db(|db| backup::integrity(&db.conn))
}

/// Saves the whole workspace as JSON. Returns the chosen file name.
#[tauri::command]
pub async fn export_workspace(app: AppHandle, state: St<'_>, workspace_id: String) -> AppResult<String> {
    let json = state.with_db(|db| export::workspace_json(&db.conn, &workspace_id))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d");
    let path = ask(&state, || {
        app.dialog()
            .file()
            .set_title("Экспорт пространства")
            .set_file_name(format!("family-budget-{stamp}.json"))
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })?;
    std::fs::write(&path, serde_json::to_vec_pretty(&json)?)?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

#[tauri::command]
pub async fn export_transactions_csv(
    app: AppHandle,
    state: St<'_>,
    workspace_id: String,
    filter: TransactionFilter,
) -> AppResult<String> {
    let csv = state.with_db(|db| export::transactions_csv(&db.conn, &workspace_id, &filter))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d");
    let path = ask(&state, || {
        app.dialog()
            .file()
            .set_title("Экспорт операций")
            .set_file_name(format!("operations-{stamp}.csv"))
            .add_filter("CSV", &["csv"])
            .blocking_save_file()
    })?;
    std::fs::write(&path, csv)?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}
