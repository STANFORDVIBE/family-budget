//! Contract for a future cloud synchronization. Version 1.0 is local-only: the app records which
//! rows changed (see `sync_metadata`) and ships `LocalOnlyProvider`, which never sends anything.
//! A real provider plugs in here without touching the financial logic.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// One changed row, as a provider would send it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecord {
    pub entity: String,
    pub entity_id: String,
    pub workspace_id: Option<String>,
    pub version: i64,
    pub deleted: bool,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Default)]
pub struct PullResult {
    pub changes: Vec<ChangeRecord>,
    pub cursor: Option<String>,
}

pub trait SyncProvider: Send + Sync {
    fn name(&self) -> &'static str;
    /// Sends local changes; returns ids accepted by the remote side. Must be idempotent:
    /// sending the same (entity, id, version) twice has no extra effect.
    fn push(&self, changes: &[ChangeRecord]) -> AppResult<Vec<String>>;
    /// Fetches remote changes since `cursor`.
    fn pull(&self, workspace_id: &str, cursor: Option<&str>) -> AppResult<PullResult>;
}

/// Provider used in 1.0: data never leaves the computer.
pub struct LocalOnlyProvider;

impl SyncProvider for LocalOnlyProvider {
    fn name(&self) -> &'static str {
        "local"
    }

    fn push(&self, _changes: &[ChangeRecord]) -> AppResult<Vec<String>> {
        Ok(Vec::new())
    }

    fn pull(&self, _workspace_id: &str, _cursor: Option<&str>) -> AppResult<PullResult> {
        Ok(PullResult::default())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncState {
    InSync,
    LocalAhead,
    RemoteAhead,
    Conflict,
}

/// Compares a row's local version and the remote version against the last synced version.
/// Both sides changed since the last sync → conflict that needs a resolution policy.
pub fn compare_versions(local: i64, last_synced: Option<i64>, remote: Option<i64>) -> SyncState {
    let base = last_synced.unwrap_or(0);
    let local_changed = local > base;
    let remote_changed = remote.is_some_and(|r| r > base);
    match (local_changed, remote_changed) {
        (false, false) => SyncState::InSync,
        (true, false) => SyncState::LocalAhead,
        (false, true) => SyncState::RemoteAhead,
        (true, true) => SyncState::Conflict,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_conflicts() {
        assert_eq!(compare_versions(3, Some(3), Some(3)), SyncState::InSync);
        assert_eq!(compare_versions(4, Some(3), Some(3)), SyncState::LocalAhead);
        assert_eq!(compare_versions(3, Some(3), Some(5)), SyncState::RemoteAhead);
        assert_eq!(compare_versions(4, Some(3), Some(5)), SyncState::Conflict);
        assert_eq!(compare_versions(1, None, None), SyncState::LocalAhead);
    }

    #[test]
    fn local_provider_sends_nothing() {
        let p = LocalOnlyProvider;
        assert!(p.push(&[]).unwrap().is_empty());
        assert!(p.pull("ws", None).unwrap().changes.is_empty());
    }
}
