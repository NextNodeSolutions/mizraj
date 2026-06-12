use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

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

/// Minimum spacing between two emitted frames (TP3): ~8ms ≈ 120fps. Under
/// sustained output the render thread folds everything that arrives inside the
/// window into one frame instead of emitting per burst.
const FRAME_WINDOW: Duration = Duration::from_millis(8);

/// A unit of work for the render thread: VT bytes to parse, a resize to apply,
/// a key press to encode, or a subscription flip. All travel the same channel
/// so the render thread processes them in send order — `resize_session`
/// enqueues the resize BEFORE resizing the PTY, a key encodes against whatever
/// terminal modes the preceding bytes established, and a subscribe takes effect
/// exactly between the writes that precede and follow it.
enum RenderInput {
    Bytes(Vec<u8>),
    Resize { rows: u16, cols: u16 },
    Key(KeyStroke),
    SetSubscribed(bool),
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
        Self::with_emitter(
            move |frame| {
                let _ = app.emit(AGENT_CELLS_EVENT, frame);
            },
            session_id,
            pty_input,
        )
    }

    /// Same as [`new`](Self::new) but with the frame transport abstracted: the
    /// render thread hands every emitted [`CellFrame`] to `emit`. Production
    /// wraps `app.emit`; tests capture frames on a channel.
    fn with_emitter<E>(emit: E, session_id: SessionId, pty_input: PtyInputSender<Vec<u8>>) -> Self
    where
        E: Fn(CellFrame) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<RenderInput>();
        thread::spawn(move || render_loop(emit, session_id, rx, pty_input));
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

    fn set_subscribed(&self, subscribed: bool) {
        // Rides the same ordered channel as bytes, so frames stop (or resume)
        // exactly at the flip point rather than racing in-flight output.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::SetSubscribed(subscribed));
        }
    }
}

/// Spin up the render thread's state and pump the input channel until it
/// disconnects (sink dropped on session close).
fn render_loop<E: Fn(CellFrame)>(
    emit: E,
    session_id: SessionId,
    rx: Receiver<RenderInput>,
    pty_input: PtyInputSender<Vec<u8>>,
) {
    let Some(state) = RenderLoop::init(emit, session_id, pty_input) else {
        return;
    };
    state.run(&rx);
}

/// Everything the render thread owns: the libghostty terminal, its render
/// state, the key encoder, the subscription gate and the way back to the PTY.
/// The libghostty handles are `!Send`, so the whole struct lives and dies on
/// the render thread.
struct RenderLoop<E: Fn(CellFrame)> {
    terminal: Terminal,
    render_state: RenderState,
    encoder: Option<KeyEncoder>,
    // Frames are emitted only while a frontend pane is subscribed (TP3). The
    // terminal keeps feeding regardless so its grid stays current; skipped
    // updates leave the damage accumulated, which makes the first update after
    // a re-subscribe report dirty and push the whole hidden-era catch-up frame.
    subscribed: bool,
    // When the previous frame went out; emission waits out the rest of
    // [`FRAME_WINDOW`] before the next one (TP3 pacing).
    last_emit: Option<Instant>,
    pty_input: PtyInputSender<Vec<u8>>,
    emit: E,
    session_id: SessionId,
}

impl<E: Fn(CellFrame)> RenderLoop<E> {
    fn init(emit: E, session_id: SessionId, pty_input: PtyInputSender<Vec<u8>>) -> Option<Self> {
        let sid = session_id.as_str();
        let terminal = match Terminal::new(DEFAULT_ROWS, DEFAULT_COLS) {
            Ok(terminal) => terminal,
            Err(err) => {
                tracing::error!(session_id = sid, error = %err, "terminal init failed; no cell frames");
                return None;
            }
        };
        let render_state = match RenderState::new() {
            Ok(state) => state,
            Err(err) => {
                tracing::error!(session_id = sid, error = %err, "render state init failed; no cell frames");
                return None;
            }
        };
        // A key-encoder failure must not kill output rendering: keep going
        // without one and drop keystrokes (logged once here).
        let encoder = match KeyEncoder::new() {
            Ok(encoder) => Some(encoder),
            Err(err) => {
                tracing::error!(session_id = sid, error = %err, "key encoder init failed; keystrokes ignored");
                None
            }
        };
        Some(Self {
            terminal,
            render_state,
            encoder,
            subscribed: false,
            last_emit: None,
            pty_input,
            emit,
            session_id,
        })
    }

    /// Block for the next input, then drain whatever else already arrived so
    /// one frame covers the whole burst instead of one frame per chunk. A
    /// resize in the burst reflows the grid, which RenderState reports as
    /// dirty just like new bytes do — so the unified path below emits the
    /// reflowed frame too. Keys produce PTY bytes, not grid changes, so they
    /// leave the frame clean.
    fn run(mut self, rx: &Receiver<RenderInput>) {
        loop {
            let Ok(input) = rx.recv() else {
                break;
            };
            self.apply(input);
            self.drain(rx);

            if !self.subscribed {
                continue;
            }
            if self.refresh_dirty() == Dirty::Clean {
                continue;
            }

            // A frame is due. Wait out the rest of the frame window first,
            // folding anything that arrives meanwhile into this frame, then
            // merge that late input and emit the freshest grid. The frame goes
            // out even if an unsubscribe slipped into the window: it was due
            // from the subscribed era, and emitting keeps the
            // update→emit→mark_clean chain atomic (skipping here would consume
            // the damage without ever painting it, leaving a re-subscribed
            // pane stale until new output).
            let disconnected = self.pace(rx);
            self.refresh_dirty();
            self.emit_frame();
            self.last_emit = Some(Instant::now());

            if disconnected {
                break;
            }
        }
    }

    /// Sleep until [`FRAME_WINDOW`] has elapsed since the previous emit,
    /// processing (and thereby coalescing) any input that lands in the
    /// meantime. Returns `true` when the channel disconnected during the wait
    /// so [`run`](Self::run) emits the pending frame one last time and stops —
    /// the final frame of a session is never dropped.
    fn pace(&mut self, rx: &Receiver<RenderInput>) -> bool {
        let Some(last_emit) = self.last_emit else {
            return false;
        };
        let deadline = last_emit + FRAME_WINDOW;
        loop {
            let now = Instant::now();
            let Some(remaining) = deadline.checked_duration_since(now) else {
                return false;
            };
            match rx.recv_timeout(remaining) {
                Ok(input) => {
                    self.apply(input);
                    self.drain(rx);
                }
                Err(RecvTimeoutError::Timeout) => return false,
                Err(RecvTimeoutError::Disconnected) => return true,
            }
        }
    }

    fn apply(&mut self, input: RenderInput) {
        let sid = self.session_id.as_str();
        match input {
            RenderInput::Bytes(bytes) => {
                if let Err(err) = self.terminal.feed(&bytes) {
                    tracing::warn!(session_id = sid, error = %err, "terminal feed failed");
                }
            }
            RenderInput::Resize { rows, cols } => {
                if let Err(err) = self.terminal.resize(rows, cols) {
                    tracing::warn!(session_id = sid, error = %err, "terminal resize failed");
                }
            }
            RenderInput::Key(stroke) => {
                let Some(encoder) = self.encoder.as_mut() else {
                    return;
                };
                encode_key(&self.terminal, encoder, &self.pty_input, &stroke, sid);
            }
            RenderInput::SetSubscribed(value) => {
                self.subscribed = value;
            }
        }
    }

    fn drain(&mut self, rx: &Receiver<RenderInput>) {
        while let Ok(more) = rx.try_recv() {
            self.apply(more);
        }
    }

    /// Sync the render state with the terminal and report the damage. Dirty
    /// tracking is the whole point of RenderState: a clean report skips
    /// snapshotting and emitting (e.g. a chunk of only control bytes, or a
    /// burst of pure keystrokes). An update failure degrades to Clean so the
    /// frame is simply skipped.
    fn refresh_dirty(&mut self) -> Dirty {
        match self.render_state.update(&mut self.terminal) {
            Ok(dirty) => dirty,
            Err(err) => {
                let sid = self.session_id.as_str();
                tracing::warn!(session_id = sid, error = %err, "render state update failed");
                Dirty::Clean
            }
        }
    }

    fn emit_frame(&mut self) {
        let sid = self.session_id.as_str();
        let cells = match self.render_state.snapshot() {
            Ok(cells) => cells,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "render state snapshot failed");
                return;
            }
        };

        // A cursor read failure must not drop the whole frame: degrade to no
        // cursor (None) and still paint the grid.
        let cursor = self.render_state.cursor().unwrap_or_else(|err| {
            tracing::warn!(session_id = sid, error = %err, "render state cursor read failed");
            None
        });

        let frame = CellFrame::from_cells(sid.to_string(), cells, cursor);
        (self.emit)(frame);

        if let Err(err) = self.render_state.mark_clean() {
            tracing::warn!(session_id = sid, error = %err, "render state mark_clean failed");
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
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    use super::*;

    /// Long enough for the render thread to feed + snapshot a few bytes,
    /// short enough to keep negative assertions cheap.
    const FRAME_WAIT: Duration = Duration::from_millis(500);

    fn frame_capturing_sink() -> (TermSink, Receiver<CellFrame>) {
        let (frame_tx, frame_rx) = mpsc::channel::<CellFrame>();
        let (pty_tx, _pty_rx) = tauri::async_runtime::channel::<Vec<u8>>(8);
        let sink = TermSink::with_emitter(
            move |frame| {
                let _ = frame_tx.send(frame);
            },
            SessionId::new(),
            pty_tx,
        );
        (sink, frame_rx)
    }

    #[test]
    fn agent_cells_event_name_is_stable() {
        assert_eq!(AGENT_CELLS_EVENT, "agent:cells");
    }

    #[test]
    fn emits_no_frame_while_unsubscribed() {
        let (sink, frames) = frame_capturing_sink();

        sink.write(b"hello");

        assert_eq!(
            frames.recv_timeout(FRAME_WAIT).err(),
            Some(RecvTimeoutError::Timeout),
            "a session nobody watches must not emit cell frames"
        );
    }

    #[test]
    fn subscribing_flushes_output_accumulated_while_hidden() {
        let (sink, frames) = frame_capturing_sink();

        sink.write(b"hi");
        sink.set_subscribed(true);

        let frame = frames
            .recv_timeout(FRAME_WAIT)
            .expect("subscribing must emit the catch-up frame without new output");
        let row: String = frame.cells[..2].iter().map(|cell| &*cell.ch).collect();
        assert_eq!(row, "hi");
    }

    #[test]
    fn sustained_output_is_coalesced_to_the_frame_window() {
        let (sink, frames) = frame_capturing_sink();
        sink.set_subscribed(true);

        // 30 writes spaced ~2ms apart ≈ 60ms of sustained output. Unpaced,
        // each write lands alone in its burst and emits its own frame (~30);
        // paced at ~8ms per frame the whole run fits in roughly 60/8 ≈ 8
        // frames. The bound leaves generous slack for scheduler jitter while
        // staying far below the unpaced count.
        for _ in 0..30 {
            sink.write(b"x");
            thread::sleep(Duration::from_millis(2));
        }

        let mut emitted = 0;
        while frames.recv_timeout(FRAME_WAIT).is_ok() {
            emitted += 1;
        }
        assert!(
            (1..=15).contains(&emitted),
            "sustained output must be coalesced to ~one frame per window, got {emitted}"
        );
    }

    #[test]
    fn the_last_frame_of_a_burst_is_never_dropped() {
        let (sink, frames) = frame_capturing_sink();
        sink.set_subscribed(true);

        for _ in 0..30 {
            sink.write(b"y");
            thread::sleep(Duration::from_millis(2));
        }
        sink.write(b"!");

        let mut last = None;
        while let Ok(frame) = frames.recv_timeout(FRAME_WAIT) {
            last = Some(frame);
        }
        let last = last.expect("at least one frame for the burst");
        let row: String = last.cells[..31].iter().map(|cell| &*cell.ch).collect();
        assert_eq!(
            row, "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy!",
            "the final frame must carry the burst's last byte"
        );
    }

    #[test]
    fn unsubscribing_stops_emission() {
        let (sink, frames) = frame_capturing_sink();

        sink.set_subscribed(true);
        sink.write(b"a");
        frames
            .recv_timeout(FRAME_WAIT)
            .expect("subscribed session emits on write");

        sink.set_subscribed(false);
        // Drain whatever was already in flight from the subscribed era (the
        // subscribe's initial-sync frame can land in its own burst): emission
        // stops at the flip point on the ordered channel, not instantly.
        while frames.recv_timeout(Duration::from_millis(100)).is_ok() {}

        sink.write(b"b");

        assert_eq!(
            frames.recv_timeout(FRAME_WAIT).err(),
            Some(RecvTimeoutError::Timeout),
            "no frames may flow once the last watcher is gone"
        );
    }
}
