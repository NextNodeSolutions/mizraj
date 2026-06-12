use thiserror::Error;

mod cells;
mod device;
mod key;
mod mouse;
mod paste;
mod render_state;
mod terminal;

pub use device::PtyWriter;

pub use cells::{Attrs, Cell, CellWidth, Cells, Color};
pub use key::{KeyEncoder, Mods};
pub use mouse::{MouseAction, MouseButton, MouseEncoder, MouseInput};
pub use paste::encode_paste;
pub use render_state::{Cursor, CursorShape, Dirty, RenderState};
pub use terminal::{ScrollViewport, ScrollbarState, Terminal, DEFAULT_MAX_SCROLLBACK_LINES};

pub type Result<T> = std::result::Result<T, TermError>;

#[derive(Debug, Error)]
pub enum TermError {
    #[error("terminal init failed: {0}")]
    Init(String),
    #[error("feed bytes failed: {0}")]
    Feed(String),
    #[error("resize failed: {0}")]
    Resize(String),
    #[error("key encode failed: {0}")]
    Encode(String),
    #[error("mode query failed: {0}")]
    Mode(String),
    #[error("paste encode failed: {0}")]
    Paste(String),
}
