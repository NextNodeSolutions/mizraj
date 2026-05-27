use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("binary not found on PATH: {0}")]
    BinaryNotFound(String),

    #[error("failed to spawn pty: {0}")]
    Spawn(String),

    #[error("failed to probe login-shell PATH: {0}")]
    PathProbe(#[source] std::io::Error),
}

impl From<which::Error> for SessionError {
    fn from(err: which::Error) -> Self {
        SessionError::BinaryNotFound(err.to_string())
    }
}
