//! Pure financial logic. No database, no Tauri, no UI: everything here is testable in isolation.

pub mod budget;
pub mod dates;
pub mod goal;
pub mod ledger;
pub mod money;
pub mod recurring;
pub mod sync;
