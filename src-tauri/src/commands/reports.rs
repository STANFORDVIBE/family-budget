use super::St;
use crate::app::analytics::{self, Analytics, AnalyticsFilter, Dashboard};
use crate::app::audit::{self, AuditEntry, AuditFilter};
use crate::error::AppResult;

#[tauri::command]
pub async fn get_dashboard(state: St<'_>, workspace_id: String, from: String, to: String) -> AppResult<Dashboard> {
    state.with_db(|db| analytics::dashboard(&db.conn, &workspace_id, &from, &to))
}

#[tauri::command]
pub async fn get_analytics(state: St<'_>, workspace_id: String, filter: AnalyticsFilter) -> AppResult<Analytics> {
    state.with_db(|db| analytics::analytics(&db.conn, &workspace_id, &filter))
}

#[tauri::command]
pub async fn list_audit(state: St<'_>, workspace_id: String, filter: AuditFilter) -> AppResult<Vec<AuditEntry>> {
    state.with_db(|db| audit::list(&db.conn, &workspace_id, &filter))
}
