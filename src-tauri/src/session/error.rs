use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("failed to spawn pty: {0}")]
    Spawn(String),
}
