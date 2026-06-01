pub mod cell_frame;
pub mod commands;
pub mod error;
pub mod handle;
pub mod id;
pub mod key;
pub mod label;
pub mod manager;
pub mod path;
pub mod pty;
pub mod sink;
pub mod tauri_sink;
pub mod term_sink;

pub use cell_frame::CellFrame;
pub use error::SessionError;
pub use handle::SessionHandle;
pub use id::SessionId;
pub use key::KeyStroke;
pub use manager::SessionManager;
pub use sink::OutputSink;
pub use tauri_sink::{
    AgentOutputPayload, SessionEndPayload, TauriEventSink, AGENT_END_EVENT, AGENT_OUTPUT_EVENT,
};
pub use term_sink::{TermSink, AGENT_CELLS_EVENT};
