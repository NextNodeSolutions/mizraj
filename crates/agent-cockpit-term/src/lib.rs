use thiserror::Error;

mod cells;
mod render_state;
mod terminal;

pub use cells::{Attrs, Cell, Cells, Color};
pub use render_state::{Dirty, RenderState};
pub use terminal::Terminal;

pub type Result<T> = std::result::Result<T, TermError>;

#[derive(Debug, Error)]
pub enum TermError {
    #[error("terminal init failed: {0}")]
    Init(String),
    #[error("feed bytes failed: {0}")]
    Feed(String),
}
