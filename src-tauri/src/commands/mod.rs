//! IPC surface exposed to the WebView. Commands are thin: they deserialize (serde rejects
//! malformed input), call the application layer and return its result. All validation of values
//! happens in `app`/`domain`; file paths are chosen only through native dialogs here.

pub mod data;
pub mod finance;
pub mod planning;
pub mod reports;
pub mod workspace;

use tauri::State;

use crate::state::AppState;

pub type St<'a> = State<'a, AppState>;
