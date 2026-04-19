use serde::Serialize;

/// Error type returned from Tauri commands. Converts to a plain string
/// on the IPC boundary so the frontend gets a readable message.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("github api error ({status}): {message}")]
    GitHub { status: u16, message: String },

    #[error("not authenticated")]
    NotAuthenticated,

    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("store error: {0}")]
    Store(String),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("auth pending")]
    AuthPending,

    #[error("auth slow down")]
    AuthSlowDown,

    #[error("auth expired, restart device flow")]
    AuthExpired,

    #[error("auth denied")]
    AuthDenied,

    #[error("{0}")]
    Other(String),
}

impl From<tauri_plugin_store::Error> for Error {
    fn from(e: tauri_plugin_store::Error) -> Self {
        Error::Store(e.to_string())
    }
}

impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Error::Other(e.to_string())
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
