use thiserror::Error;

pub type Result<T> = std::result::Result<T, TermError>;

#[derive(Debug, Error)]
pub enum TermError {
    #[error("terminal init failed: {0}")]
    Init(String),
    #[error("feed bytes failed: {0}")]
    Feed(String),
}
