//! App updates from GitHub Releases, only when the user presses the button: the app never goes
//! online by itself. It fetches a small `latest.json` and, on request, the signed installer.
//! No financial data is ever sent. The installer is verified against the public key in
//! `tauri.conf.json`.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

use super::St;
use crate::app::backup;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

async fn find_update(app: &AppHandle) -> AppResult<Option<Update>> {
    let updater = app.updater().map_err(|_| AppError::UpdateFailed)?;
    updater.check().await.map_err(|_| AppError::UpdateFailed)
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    Ok(find_update(&app).await?.map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
    }))
}

/// Saves a backup, then downloads, verifies and runs the installer. The app exits while it
/// installs and the installer starts it again.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: St<'_>) -> AppResult<()> {
    let update = find_update(&app).await?.ok_or(AppError::NotFound)?;
    // The new version may migrate the database: keep a way back.
    state.with_db(|db| {
        let dir = state.backup_dir(db)?;
        backup::before_update_backup(&db.conn, &dir)
    })?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|_| AppError::UpdateFailed)?;
    app.restart();
}
