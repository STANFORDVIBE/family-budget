//! SQLite connection: opening, safety pragmas and migrations.

pub mod migrations;
pub mod seed;

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppResult;

pub const DB_FILE_NAME: &str = "family-budget.db";

pub struct Database {
    pub conn: Connection,
    pub path: Option<PathBuf>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Database> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let mut db = Database { conn, path: Some(path.to_path_buf()) };
        db.prepare()?;
        Ok(db)
    }

    pub fn open_in_memory() -> AppResult<Database> {
        let mut db = Database { conn: Connection::open_in_memory()?, path: None };
        db.prepare()?;
        Ok(db)
    }

    /// Pragmas, migrations and reference data. Also used after a restore.
    pub fn prepare(&mut self) -> AppResult<()> {
        configure(&self.conn)?;
        migrations::apply(&mut self.conn)?;
        seed::currencies(&self.conn)?;
        Ok(())
    }
}

/// Durability first: WAL with FULL sync survives power loss without losing committed operations.
pub fn configure(conn: &Connection) -> AppResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}
