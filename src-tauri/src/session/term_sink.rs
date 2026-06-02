use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;

use mizraj_term::{Dirty, KeyEncoder, RenderState, Terminal};
use tauri::async_runtime::Sender as PtyInputSender;
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::cell_frame::CellFrame;
use crate::session::id::SessionId;
use crate::session::key::KeyStroke;
use crate::session::pty::{DEFAULT_COLS, DEFAULT_ROWS};
use crate::session::sink::OutputSink;

/// Single global event carrying a grid snapshot per render frame (D4). The
/// `session_id` rides in the [`CellFrame`] payload, mirroring `agent:output`.
pub const AGENT_CELLS_EVENT: &str = "agent:cells";

/// A unit of work for the render thread: VT bytes to parse, a resize to apply,
/// or a key press to encode. All three travel the same channel so the render
/// thread processes them in send order — `resize_session` enqueues the resize
/// BEFORE resizing the PTY, and a key encodes against whatever terminal modes
/// the preceding bytes established.
enum RenderInput {
    Bytes(Vec<u8>),
    Resize { rows: u16, cols: u16 },
    Key(KeyStroke),
}

/// `OutputSink` that turns raw PTY bytes into rendered grid snapshots, and the
/// reverse: turns frontend key presses into PTY input bytes.
///
/// The libghostty `Terminal`/`RenderState`/`KeyEncoder` are `!Send` (they hold
/// raw FFI pointers), and parsing + snapshotting blows the sink's ~1ms `write`
/// budget. So [`write`](OutputSink::write)/[`key`](OutputSink::key) only copy
/// onto a channel; a dedicated render thread owns the terminal, coalesces
/// bursts, emits one `agent:cells` event per dirty frame, and encodes keys
/// against the terminal's live modes — pushing the encoded bytes to the PTY via
/// `pty_input`. The thread exits when the sink is dropped (channel disconnects
/// on session close).
pub struct TermSink {
    // `mpsc::Sender` is `Send` but not `Sync`; `OutputSink` requires both, so
    // guard it with a `Mutex`. The lock is held only for the handoff.
    tx: Mutex<Sender<RenderInput>>,
}

impl TermSink {
    /// `pty_input` is a clone of the session's PTY-master input channel (the
    /// same one `pty_write_loop` drains); the render thread writes encoded
    /// keystrokes into it so a key press round-trips to the child.
    pub fn new<R: Runtime>(
        app: AppHandle<R>,
        session_id: SessionId,
        pty_input: PtyInputSender<Vec<u8>>,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<RenderInput>();
        thread::spawn(move || render_loop(app, session_id, rx, pty_input));
        Self { tx: Mutex::new(tx) }
    }
}

impl OutputSink for TermSink {
    fn write(&self, bytes: &[u8]) {
        // Non-blocking handoff. A disconnected channel (render thread gone after
        // an init failure) simply drops the bytes — output is best-effort here.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Bytes(bytes.to_vec()));
        }
    }

    fn resize(&self, rows: u16, cols: u16) {
        // Keep the render-side terminal in lockstep with the PTY. Same
        // best-effort handoff as `write`; a dropped resize is corrected by the
        // next one (the frontend re-sends on every grid change).
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Resize { rows, cols });
        }
    }

    fn key(&self, stroke: KeyStroke) {
        // Same best-effort handoff: the encode happens on the render thread,
        // where the terminal (and its live modes) lives.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Key(stroke));
        }
    }
}

/// Own the terminal + render state + key encoder, drain the input channel, and
/// emit a frame per dirty snapshot until the channel disconnects.
fn render_loop<R: Runtime>(
    app: AppHandle<R>,
    session_id: SessionId,
    rx: Receiver<RenderInput>,
    pty_input: PtyInputSender<Vec<u8>>,
) {
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
    // A key-encoder failure must not kill output rendering: keep going without
    // one and drop keystrokes (logged once here), rather than returning.
    let mut encoder = match KeyEncoder::new() {
        Ok(encoder) => Some(encoder),
        Err(err) => {
            tracing::error!(session_id = sid, error = %err, "key encoder init failed; keystrokes ignored");
            None
        }
    };

    // Block for the next input, then drain whatever else already arrived so one
    // frame covers the whole burst instead of one frame per chunk. A resize in
    // the burst reflows the grid, which RenderState reports as dirty just like
    // new bytes do — so the unified path below emits the reflowed frame too.
    // Keys produce PTY bytes, not grid changes, so they leave the frame clean.
    while let Ok(input) = rx.recv() {
        apply(&mut terminal, &mut encoder, &pty_input, input, sid);
        while let Ok(more) = rx.try_recv() {
            apply(&mut terminal, &mut encoder, &pty_input, more, sid);
        }

        let dirty = match render_state.update(&mut terminal) {
            Ok(dirty) => dirty,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "render state update failed");
                continue;
            }
        };
        // Dirty tracking is the whole point of RenderState: skip snapshotting and
        // emitting when nothing changed (e.g. a chunk of only control bytes, or a
        // burst of pure keystrokes).
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

fn apply(
    terminal: &mut Terminal,
    encoder: &mut Option<KeyEncoder>,
    pty_input: &PtyInputSender<Vec<u8>>,
    input: RenderInput,
    session_id: &str,
) {
    match input {
        RenderInput::Bytes(bytes) => {
            if let Err(err) = terminal.feed(&bytes) {
                tracing::warn!(session_id, error = %err, "terminal feed failed");
            }
        }
        RenderInput::Resize { rows, cols } => {
            if let Err(err) = terminal.resize(rows, cols) {
                tracing::warn!(session_id, error = %err, "terminal resize failed");
            }
        }
        RenderInput::Key(stroke) => {
            let Some(encoder) = encoder.as_mut() else {
                return;
            };
            encode_key(terminal, encoder, pty_input, &stroke, session_id);
        }
    }
}

/// Encode one key press against the terminal's current modes and push the bytes
/// to the PTY. Empty encodings (lone modifiers, unmapped keys) send nothing.
fn encode_key(
    terminal: &Terminal,
    encoder: &mut KeyEncoder,
    pty_input: &PtyInputSender<Vec<u8>>,
    stroke: &KeyStroke,
    session_id: &str,
) {
    let bytes = match encoder.encode(
        terminal,
        &stroke.code,
        stroke.text.as_deref(),
        stroke.mods(),
    ) {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::warn!(session_id, error = %err, "key encode failed");
            return;
        }
    };
    if bytes.is_empty() {
        return;
    }
    // Best-effort, mirroring `write`/`resize`: a full input queue means the child
    // is not reading and a closed channel means the session is tearing down —
    // dropping one keystroke beats blocking the render thread (`try_send`, never
    // `blocking_send`, so output frames keep flowing).
    if let Err(err) = pty_input.try_send(bytes) {
        tracing::debug!(session_id, error = %err, "dropping keystroke; PTY input unavailable");
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
