use serde::Serialize;

use super::St;
use crate::app::backup;
use crate::app::members::{self, Member, MemberInput};
use crate::app::settings::{self, FormMemory, Settings, SettingsUpdate};
use crate::app::setup::{self, Currency, OnboardingInput, User};
use crate::app::workspaces::{self, Workspace, WorkspaceInput, WorkspaceUpdate};
use crate::error::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    /// Set when the database could not be opened: the UI shows the recovery screen.
    pub open_error: Option<&'static str>,
    pub user: Option<User>,
    pub workspaces: Vec<Workspace>,
    pub currencies: Vec<Currency>,
    pub settings: Option<Settings>,
    pub app_version: &'static str,
}

#[tauri::command]
pub async fn get_bootstrap(state: St<'_>) -> AppResult<Bootstrap> {
    if let Some(error) = state.open_error() {
        return Ok(Bootstrap {
            open_error: Some(error),
            user: None,
            workspaces: Vec::new(),
            currencies: Vec::new(),
            settings: None,
            app_version: env!("CARGO_PKG_VERSION"),
        });
    }
    state.with_db(|db| {
        Ok(Bootstrap {
            open_error: None,
            user: setup::user(&db.conn)?,
            workspaces: workspaces::list(&db.conn)?,
            currencies: setup::currencies(&db.conn)?,
            settings: Some(settings::get(&db.conn)?),
            app_version: env!("CARGO_PKG_VERSION"),
        })
    })
}

#[tauri::command]
pub async fn complete_onboarding(state: St<'_>, input: OnboardingInput) -> AppResult<Vec<Workspace>> {
    state.with_db(|db| setup::complete_onboarding(&mut db.conn, &input))
}

#[tauri::command]
pub async fn rename_user(state: St<'_>, name: String) -> AppResult<User> {
    state.with_db(|db| setup::rename_user(&mut db.conn, &name))
}

#[tauri::command]
pub async fn create_workspace(state: St<'_>, input: WorkspaceInput) -> AppResult<Workspace> {
    state.with_db(|db| workspaces::create(&mut db.conn, &input))
}

#[tauri::command]
pub async fn update_workspace(state: St<'_>, workspace_id: String, input: WorkspaceUpdate) -> AppResult<Workspace> {
    state.with_db(|db| workspaces::update(&mut db.conn, &workspace_id, &input))
}

/// Deletes a workspace after saving a backup it can be restored from. Returns the backup's name.
#[tauri::command]
pub async fn delete_workspace(state: St<'_>, workspace_id: String) -> AppResult<String> {
    state.with_db(|db| {
        workspaces::get(&db.conn, &workspace_id)?;
        let dir = state.backup_dir(db)?;
        let name = backup::named_backup(&db.conn, &dir, "before-delete-")?;
        workspaces::delete(&mut db.conn, &workspace_id)?;
        Ok(name)
    })
}

#[tauri::command]
pub async fn list_members(state: St<'_>, workspace_id: String) -> AppResult<Vec<Member>> {
    state.with_db(|db| members::list(&db.conn, &workspace_id))
}

#[tauri::command]
pub async fn create_member(state: St<'_>, workspace_id: String, input: MemberInput) -> AppResult<Member> {
    state.with_db(|db| members::create(&mut db.conn, &workspace_id, &input))
}

#[tauri::command]
pub async fn update_member(state: St<'_>, workspace_id: String, id: String, input: MemberInput) -> AppResult<Member> {
    state.with_db(|db| members::update(&mut db.conn, &workspace_id, &id, &input))
}

#[tauri::command]
pub async fn update_settings(state: St<'_>, input: SettingsUpdate) -> AppResult<Settings> {
    state.with_db(|db| settings::update(&mut db.conn, &input))
}

#[tauri::command]
pub async fn get_form_memory(state: St<'_>, workspace_id: String) -> AppResult<FormMemory> {
    state.with_db(|db| settings::form_memory(&db.conn, &workspace_id))
}
