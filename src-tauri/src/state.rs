use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::app::settings;
use crate::db::{DB_FILE_NAME, Database};
use crate::error::{AppError, AppResult};

pub struct AppState {
    pub data_dir: PathBuf,
    db: Mutex<Option<Database>>,
    /// Why the database could not be opened (shown on the recovery screen).
    open_error: Mutex<Option<&'static str>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppState {
        let (db, error) = match Database::open(&data_dir.join(DB_FILE_NAME)) {
            Ok(db) => (Some(db), None),
            Err(AppError::UnsupportedVersion) => (None, Some("unsupported_version")),
            Err(_) => (None, Some("open_failed")),
        };
        AppState { data_dir, db: Mutex::new(db), open_error: Mutex::new(error) }
    }

    pub fn lock(&self) -> MutexGuard<'_, Option<Database>> {
        // A panic while holding the lock must not brick the app: the database itself is
        // transactional, so the guard is safe to reuse.
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn open_error(&self) -> Option<&'static str> {
        *self.open_error.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn with_db<T>(&self, f: impl FnOnce(&mut Database) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.lock();
        let db = guard.as_mut().ok_or(AppError::Integrity)?;
        f(db)
    }

    /// Where backups go: the folder picked in settings, else `<data dir>/backups`.
    pub fn backup_dir(&self, db: &Database) -> AppResult<PathBuf> {
        Ok(settings::get(&db.conn)?.backup_dir.map(PathBuf::from).unwrap_or_else(|| self.default_backup_dir()))
    }

    pub fn default_backup_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join(DB_FILE_NAME)
    }

    /// After a successful restore of an unopenable database, the recovery state is cleared.
    pub fn replace_broken(&self, path: &Path) -> AppResult<()> {
        let db = Database::open(path)?;
        *self.lock() = Some(db);
        *self.open_error.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }
}
