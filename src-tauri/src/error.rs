use serde::{Serialize, Serializer};

/// Errors that may cross the IPC boundary.
///
/// Only a stable `code`, a safe message and an optional detail (a field name or currency code,
/// never SQL, paths or amounts) reach the frontend, so internals cannot leak into the UI or logs.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("validation failed: {0}")]
    Validation(&'static str),
    /// An amount in a foreign currency needs an exchange rate to the workspace base currency.
    #[error("exchange rate missing for {0}")]
    RateMissing(String),
    /// The action would break history (e.g. deleting a category that operations still use).
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error("app is not set up yet")]
    NotInitialized,
    #[error("unsupported database version")]
    UnsupportedVersion,
    #[error("invalid backup file")]
    InvalidBackup,
    #[error("data integrity check failed")]
    Integrity,
    #[error("operation cancelled")]
    Cancelled,
    #[error("amount is too large")]
    Overflow,
    #[error("database error")]
    Database(#[source] rusqlite::Error),
    #[error("io error")]
    Io(#[source] std::io::Error),
    #[error("internal error")]
    Internal,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound => "not_found",
            AppError::Validation(_) => "validation",
            AppError::RateMissing(_) => "rate_missing",
            AppError::Conflict(_) => "conflict",
            AppError::NotInitialized => "not_initialized",
            AppError::UnsupportedVersion => "unsupported_version",
            AppError::InvalidBackup => "invalid_backup",
            AppError::Integrity => "integrity",
            AppError::Cancelled => "cancelled",
            AppError::Overflow => "overflow",
            AppError::Database(_) => "database",
            AppError::Io(_) => "io",
            AppError::Internal => "internal",
        }
    }

    /// Machine-readable detail the UI can translate: a field, a reason or a currency code.
    fn detail(&self) -> Option<String> {
        match self {
            AppError::Validation(field) => Some((*field).to_string()),
            AppError::Conflict(reason) => Some((*reason).to_string()),
            AppError::RateMissing(currency) => Some(currency.clone()),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        AppError::Database(error)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        AppError::Internal
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("code", self.code())?;
        let message = match self {
            AppError::Database(_) => "database error".to_string(),
            AppError::Io(_) => "io error".to_string(),
            other => other.to_string(),
        };
        s.serialize_field("message", &message)?;
        s.serialize_field("detail", &self.detail())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_message_and_detail() {
        let json = serde_json::to_value(AppError::Validation("amount")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "validation", "message": "validation failed: amount", "detail": "amount" })
        );
    }

    #[test]
    fn database_errors_do_not_leak_details() {
        let error = AppError::from(rusqlite::Error::InvalidColumnName("secret_column".into()));
        let json = serde_json::to_string(&error).unwrap();
        assert!(!json.contains("secret_column"));
        assert!(json.contains("\"database\""));
    }
}
