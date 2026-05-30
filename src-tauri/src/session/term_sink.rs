use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;

use agent_cockpit_term::{Dirty, RenderState, Terminal};
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::cell_frame::CellFrame;
use crate::session::id::SessionId;
use crate::session::pty::{DEFAULT_COLS, DEFAULT_ROWS};
use crate::session::sink::OutputSink;

/// Single global event carrying a grid snapshot per render frame (D4). The
/// `session_id` rides in the [`CellFrame`] payload, mirroring `agent:output`.
pub const AGENT_CELLS_EVENT: &str = "agent:cells";

/// `OutputSink` that turns raw PTY bytes into rendered grid snapshots.
///
/// The libghostty `Terminal`/`RenderState` are `!Send` (they hold raw FFI
/// pointers), and parsing + snapshotting blows the sink's ~1ms `write` budget.
/// So [`write`](OutputSink::write) only copies the chunk onto a channel; a
/// dedicated render thread owns the terminal, coalesces bursts, and emits one
/// `agent:cells` event per dirty frame. The thread exits when the sink is
/// dropped (the channel disconnects on session close).
pub struct TermSink {
    // `mpsc::Sender` is `Send` but not `Sync`; `OutputSink` requires both, so
    // guard it with a `Mutex`. The lock is held only for the byte handoff.
    tx: Mutex<Sender<Vec<u8>>>,
}

impl TermSink {
    pub fn new<R: Runtime>(app: AppHandle<R>, session_id: SessionId) -> Self {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || render_loop(app, session_id, rx));
        Self { tx: Mutex::new(tx) }
    }
}

impl OutputSink for TermSink {
    fn write(&self, bytes: &[u8]) {
        // Non-blocking handoff. A disconnected channel (render thread gone after
        // an init failure) simply drops the bytes — output is best-effort here.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(bytes.to_vec());
        }
    }
}

/// Own the terminal + render state, drain the byte channel, and emit a frame
/// per dirty snapshot until the channel disconnects.
fn render_loop<R: Runtime>(app: AppHandle<R>, session_id: SessionId, rx: Receiver<Vec<u8>>) {
    let sid = session_id.as_str();

    let mut terminal = match Terminal::new(DEFAULT_ROWS, DEFAULT_COLS) {
        Ok(terminal) => terminal,
        Err(err) => {
            tracing::error!(session_id = sid, error = %err, "terminal init failed; no cell frames");
            return;
        }
    };
    let mut render_state = match RenderState::new() {
        Ok(state) => state,
        Err(err) => {
            tracing::error!(session_id = sid, error = %err, "render state init failed; no cell frames");
            return;
        }
    };

    // Block for the next chunk, then drain whatever else already arrived so one
    // frame covers the whole burst instead of one frame per chunk.
    while let Ok(chunk) = rx.recv() {
        feed(&mut terminal, &chunk, sid);
        while let Ok(more) = rx.try_recv() {
            feed(&mut terminal, &more, sid);
        }

        let dirty = match render_state.update(&mut terminal) {
            Ok(dirty) => dirty,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "render state update failed");
                continue;
            }
        };
        // Dirty tracking is the whole point of RenderState: skip snapshotting and
        // emitting when nothing changed (e.g. a chunk of only control bytes).
        if dirty == Dirty::Clean {
            continue;
        }

        let cells = match render_state.snapshot() {
            Ok(cells) => cells,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "render state snapshot failed");
                continue;
            }
        };

        let frame = CellFrame::from_cells(sid.to_string(), &cells);
        let _ = app.emit(AGENT_CELLS_EVENT, frame);

        if let Err(err) = render_state.mark_clean() {
            tracing::warn!(session_id = sid, error = %err, "render state mark_clean failed");
        }
    }
}

fn feed(terminal: &mut Terminal, bytes: &[u8], session_id: &str) {
    if let Err(err) = terminal.feed(bytes) {
        tracing::warn!(session_id, error = %err, "terminal feed failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_cells_event_name_is_stable() {
        assert_eq!(AGENT_CELLS_EVENT, "agent:cells");
    }
}
