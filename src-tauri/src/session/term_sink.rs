use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use mizraj_term::{
    encode_paste, Dirty, KeyEncoder, MouseEncoder, MouseInput, RenderState, ScrollViewport,
    Terminal,
};
use tauri::async_runtime::Sender as PtyInputSender;
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::cell_frame::{CellFrame, FrameContext};
use crate::session::id::SessionId;
use crate::session::key::KeyStroke;
use crate::session::pty::{DEFAULT_COLS, DEFAULT_ROWS};
use crate::session::sink::{FrameReply, OutputSink};

/// Single global event carrying a grid snapshot per render frame (D4). The
/// `session_id` rides in the [`CellFrame`] payload, mirroring `agent:output`.
pub const AGENT_CELLS_EVENT: &str = "agent:cells";

/// Emitted when the running program changes its OSC 0/2 title (TP13). An
/// empty/absent title is broadcast as `None` so the frontend falls back to
/// its derived label.
pub const AGENT_TITLE_EVENT: &str = "agent:title";

/// Payload of [`AGENT_TITLE_EVENT`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct TitlePayload {
    pub session_id: String,
    pub title: Option<String>,
}

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
    Snapshot(FrameReply),
    Paste(Vec<u8>),
    Reset,
    Mouse(MouseInput),
    Scroll(ScrollViewport),
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
        scrollback_lines: usize,
    ) -> Self {
        let title_app = app.clone();
        let title_sid = session_id.clone();
        Self::with_emitters(
            move |frame| {
                let _ = app.emit(AGENT_CELLS_EVENT, frame);
            },
            move |title| {
                let _ = title_app.emit(
                    AGENT_TITLE_EVENT,
                    TitlePayload {
                        session_id: title_sid.as_str().to_string(),
                        title,
                    },
                );
            },
            session_id,
            pty_input,
            scrollback_lines,
        )
    }

    /// Same as [`new`](Self::new) but with the frame transport abstracted: the
    /// render thread hands every emitted [`CellFrame`] to `emit`. Test-only —
    /// production always goes through `new` (which wraps `app.emit`), hence
    /// the cfg gate keeping the non-test build warning-free.
    #[cfg(test)]
    fn with_emitter<E>(emit: E, session_id: SessionId, pty_input: PtyInputSender<Vec<u8>>) -> Self
    where
        E: Fn(CellFrame) + Send + 'static,
    {
        Self::with_emitters(
            emit,
            |_| {},
            session_id,
            pty_input,
            mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES,
        )
    }

    fn with_emitters<E, T>(
        emit: E,
        on_title: T,
        session_id: SessionId,
        pty_input: PtyInputSender<Vec<u8>>,
        scrollback_lines: usize,
    ) -> Self
    where
        E: Fn(CellFrame) + Send + 'static,
        T: Fn(Option<String>) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<RenderInput>();
        thread::spawn(move || {
            render_loop(emit, on_title, session_id, rx, pty_input, scrollback_lines)
        });
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

    fn frame_request(&self, reply: FrameReply) {
        // Ordered like everything else: the reply reflects every write that
        // preceded the request. A dropped channel (render thread gone) leaves
        // the reply unanswered and the caller's timeout reports it.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Snapshot(reply));
        }
    }

    fn paste(&self, data: Vec<u8>) {
        // Encoded on the render thread, where the live bracketed-paste mode
        // (DEC 2004) is known.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Paste(data));
        }
    }

    fn reset_terminal(&self) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Reset);
        }
    }

    fn mouse(&self, input: MouseInput) {
        // Encoded on the render thread, against the live mouse-tracking mode.
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Mouse(input));
        }
    }

    fn scroll(&self, to: ScrollViewport) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(RenderInput::Scroll(to));
        }
    }
}

/// Spin up the render thread's state and pump the input channel until it
/// disconnects (sink dropped on session close).
fn render_loop<E: Fn(CellFrame), T: Fn(Option<String>)>(
    emit: E,
    on_title: T,
    session_id: SessionId,
    rx: Receiver<RenderInput>,
    pty_input: PtyInputSender<Vec<u8>>,
    scrollback_lines: usize,
) {
    let Some(state) = RenderLoop::init(emit, on_title, session_id, pty_input, scrollback_lines)
    else {
        return;
    };
    state.run(&rx);
}

/// Everything the render thread owns: the libghostty terminal, its render
/// state, the key encoder, the subscription gate and the way back to the PTY.
/// The libghostty handles are `!Send`, so the whole struct lives and dies on
/// the render thread.
struct RenderLoop<E: Fn(CellFrame), T: Fn(Option<String>)> {
    terminal: Terminal,
    render_state: RenderState,
    encoder: Option<KeyEncoder>,
    // Lazy: most sessions never see an app-mouse-mode program. Failure to
    // init is remembered as None-after-attempt via `mouse_encoder_failed`.
    mouse_encoder: Option<MouseEncoder>,
    mouse_encoder_failed: bool,
    // Frames are emitted only while a frontend pane is subscribed (TP3). The
    // terminal keeps feeding regardless so its grid stays current; skipped
    // updates leave the damage accumulated, which makes the first update after
    // a re-subscribe report dirty and push the whole hidden-era catch-up frame.
    subscribed: bool,
    // A viewport move must repaint even though the grid content is clean.
    force_emit: bool,
    // When the previous frame went out; emission waits out the rest of
    // [`FRAME_WINDOW`] before the next one (TP3 pacing).
    last_emit: Option<Instant>,
    pty_input: PtyInputSender<Vec<u8>>,
    emit: E,
    on_title: T,
    // The last OSC title broadcast, to emit only on change.
    last_title: Option<String>,
    session_id: SessionId,
}

impl<E: Fn(CellFrame), T: Fn(Option<String>)> RenderLoop<E, T> {
    fn init(
        emit: E,
        on_title: T,
        session_id: SessionId,
        pty_input: PtyInputSender<Vec<u8>>,
        scrollback_lines: usize,
    ) -> Option<Self> {
        let sid = session_id.as_str();
        let mut terminal = match Terminal::with_scrollback(
            DEFAULT_ROWS,
            DEFAULT_COLS,
            scrollback_lines,
        ) {
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
        // The PTY write-back makes libghostty answer DSR/DA/ENQ queries (TP14)
        // — without it, TUIs probing the terminal at startup hang. Same
        // best-effort delivery as keystrokes.
        let writer_input = pty_input.clone();
        if let Err(err) = terminal.set_pty_writer(Box::new(move |bytes| {
            let _ = writer_input.try_send(bytes.to_vec());
        })) {
            tracing::error!(session_id = sid, error = %err, "pty write-back install failed; query responses off");
        }

        Some(Self {
            terminal,
            render_state,
            encoder,
            mouse_encoder: None,
            mouse_encoder_failed: false,
            subscribed: false,
            force_emit: false,
            last_emit: None,
            pty_input,
            emit,
            on_title,
            last_title: None,
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
            self.broadcast_title_change();

            if !self.subscribed {
                self.force_emit = false;
                continue;
            }
            if self.refresh_dirty() == Dirty::Clean && !self.force_emit {
                continue;
            }
            self.force_emit = false;

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
            RenderInput::Snapshot(reply) => {
                self.reply_snapshot(&reply);
            }
            RenderInput::Paste(data) => {
                self.paste_to_pty(&data);
            }
            RenderInput::Reset => {
                self.terminal.reset();
            }
            RenderInput::Mouse(input) => {
                self.mouse_to_pty(&input);
            }
            RenderInput::Scroll(to) => {
                // Page deltas arrive pre-scaled by the caller; reposition and
                // schedule a repaint of the new window.
                self.terminal.scroll_viewport(to);
                self.force_emit = true;
            }
        }
    }

    /// Encode a mouse event against the live tracking mode and push the bytes
    /// to the PTY. Outside any tracking mode the encoder returns no bytes and
    /// nothing is sent — the frontend's local selection owns the mouse then.
    fn mouse_to_pty(&mut self, input: &MouseInput) {
        if self.mouse_encoder.is_none() && !self.mouse_encoder_failed {
            match MouseEncoder::new() {
                Ok(encoder) => self.mouse_encoder = Some(encoder),
                Err(err) => {
                    let sid = self.session_id.as_str();
                    tracing::error!(session_id = sid, error = %err, "mouse encoder init failed; mouse events ignored");
                    self.mouse_encoder_failed = true;
                }
            }
        }
        let Some(encoder) = self.mouse_encoder.as_mut() else {
            return;
        };
        let sid = self.session_id.as_str();
        let bytes = match encoder.encode(&self.terminal, input) {
            Ok(bytes) => bytes,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "mouse encode failed");
                return;
            }
        };
        if bytes.is_empty() {
            return;
        }
        if let Err(err) = self.pty_input.try_send(bytes) {
            tracing::debug!(session_id = sid, error = %err, "dropping mouse event; PTY input unavailable");
        }
    }

    /// Encode pasted text against the live bracketed-paste mode and push it to
    /// the PTY. Same best-effort delivery as keystrokes: a full input queue or
    /// closed channel drops the paste rather than stalling the render thread.
    fn paste_to_pty(&mut self, data: &[u8]) {
        let sid = self.session_id.as_str();
        let bracketed = self.terminal.bracketed_paste().unwrap_or_else(|err| {
            tracing::warn!(session_id = sid, error = %err, "bracketed-paste query failed; pasting plain");
            false
        });
        let encoded = match encode_paste(data, bracketed) {
            Ok(encoded) => encoded,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "paste encode failed; dropping paste");
                return;
            }
        };
        if encoded.is_empty() {
            return;
        }
        if let Err(err) = self.pty_input.try_send(encoded) {
            tracing::debug!(session_id = sid, error = %err, "dropping paste; PTY input unavailable");
        }
    }

    /// Serialize the current grid into `reply` (TP1: the pane pulls its first
    /// frame on mount instead of waiting for output). Subscription does not
    /// gate the pull — it's an explicit request. The render state is synced
    /// first so the reply reflects everything fed so far, but it is NOT marked
    /// clean: the pull stays read-only for the live-emission bookkeeping (at
    /// worst the next live frame repeats the same content).
    fn reply_snapshot(&mut self, reply: &FrameReply) {
        self.refresh_dirty();
        let sid = self.session_id.as_str();
        let cells = match self.render_state.snapshot() {
            Ok(cells) => cells,
            Err(err) => {
                tracing::warn!(session_id = sid, error = %err, "snapshot for frame request failed");
                return;
            }
        };
        let cursor = self.render_state.cursor().unwrap_or_else(|err| {
            tracing::warn!(session_id = sid, error = %err, "cursor read for frame request failed");
            None
        });
        let frame = CellFrame::from_cells(sid.to_string(), cells, cursor, self.frame_context());
        // try_send: the requester may have timed out and dropped the receiver;
        // never block the render thread on a gone caller.
        let _ = reply.try_send(frame);
    }

    fn drain(&mut self, rx: &Receiver<RenderInput>) {
        while let Ok(more) = rx.try_recv() {
            self.apply(more);
        }
    }

    /// Broadcast the OSC 0/2 title when it changes (TP13). Polling per burst
    /// is one cheap FFI read; `None` means "back to the derived label".
    fn broadcast_title_change(&mut self) {
        let title = self.terminal.title().unwrap_or(None);
        if title == self.last_title {
            return;
        }
        self.last_title = title.clone();
        (self.on_title)(title);
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

    /// Viewport + history rows for the frame, from the live scrollbar state.
    fn frame_context(&self) -> FrameContext {
        let scrollbar = self.terminal.scrollbar().ok();
        let mouse_reporting = self.terminal.mouse_tracking().unwrap_or(false);
        match scrollbar {
            Some(bar) => FrameContext {
                mouse_reporting,
                viewport_top: bar.total.saturating_sub(bar.offset + bar.len),
                history_total: bar.total.saturating_sub(bar.len),
            },
            None => FrameContext {
                mouse_reporting,
                ..FrameContext::default()
            },
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

        let frame = CellFrame::from_cells(sid.to_string(), cells, cursor, self.frame_context());
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
        let (sink, frame_rx, _pty_rx) = sink_with_channels();
        (sink, frame_rx)
    }

    fn sink_with_channels() -> (
        TermSink,
        Receiver<CellFrame>,
        tauri::async_runtime::Receiver<Vec<u8>>,
    ) {
        let (frame_tx, frame_rx) = mpsc::channel::<CellFrame>();
        let (pty_tx, pty_rx) = tauri::async_runtime::channel::<Vec<u8>>(8);
        let sink = TermSink::with_emitter(
            move |frame| {
                let _ = frame_tx.send(frame);
            },
            SessionId::new(),
            pty_tx,
        );
        (sink, frame_rx, pty_rx)
    }

    #[test]
    fn osc_title_changes_are_broadcast_once_per_change() {
        let (title_tx, title_rx) = mpsc::channel::<Option<String>>();
        let (pty_tx, _pty_rx) = tauri::async_runtime::channel::<Vec<u8>>(8);
        let sink = TermSink::with_emitters(
            |_frame| {},
            move |title| {
                let _ = title_tx.send(title);
            },
            SessionId::new(),
            pty_tx,
            mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES,
        );

        sink.write(b"\x1b]2;mon-titre\x07");
        assert_eq!(
            title_rx.recv_timeout(FRAME_WAIT).expect("title broadcast"),
            Some("mon-titre".to_string())
        );

        sink.write(b"\x1b]2;\x07");
        assert_eq!(
            title_rx
                .recv_timeout(FRAME_WAIT)
                .expect("title reset broadcast"),
            None
        );
    }

    #[test]
    fn dsr_query_answers_flow_back_to_the_pty() {
        let (sink, _frames, mut pty_rx) = sink_with_channels();

        sink.write(b"\x1b[6n");

        assert_eq!(next_pty_bytes(&mut pty_rx), b"\x1b[1;1R");
    }

    fn next_pty_bytes(pty_rx: &mut tauri::async_runtime::Receiver<Vec<u8>>) -> Vec<u8> {
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(FRAME_WAIT, pty_rx.recv()).await
        })
        .expect("pty bytes within the wait")
        .expect("pty channel open")
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
    fn frame_request_returns_the_current_grid_without_subscription() {
        let (sink, _frames) = frame_capturing_sink();
        sink.write(b"hi");

        let (reply_tx, mut reply_rx) = tauri::async_runtime::channel::<CellFrame>(1);
        sink.frame_request(reply_tx);

        let frame = tauri::async_runtime::block_on(async {
            tokio::time::timeout(FRAME_WAIT, reply_rx.recv()).await
        })
        .expect("frame request must be answered within the wait")
        .expect("reply channel must carry a frame");

        let row: String = frame.cells[..2].iter().map(|cell| &*cell.ch).collect();
        assert_eq!(row, "hi", "the pulled frame must reflect prior writes");
    }

    #[test]
    fn frame_request_leaves_the_live_flow_untouched() {
        let (sink, frames) = frame_capturing_sink();
        sink.set_subscribed(true);

        let (reply_tx, mut reply_rx) = tauri::async_runtime::channel::<CellFrame>(1);
        sink.frame_request(reply_tx);
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(FRAME_WAIT, reply_rx.recv()).await
        })
        .expect("frame request answered")
        .expect("reply carries a frame");

        sink.write(b"z");
        let mut saw_z = false;
        while let Ok(frame) = frames.recv_timeout(FRAME_WAIT) {
            if &*frame.cells[0].ch == "z" {
                saw_z = true;
                break;
            }
        }
        assert!(saw_z, "live frames must keep flowing after a pull");
    }

    #[test]
    fn paste_converts_newlines_when_bracketed_mode_is_off() {
        let (sink, _frames, mut pty_rx) = sink_with_channels();

        sink.paste(b"a\nb".to_vec());

        assert_eq!(next_pty_bytes(&mut pty_rx), b"a\rb");
    }

    #[test]
    fn paste_wraps_in_markers_once_the_child_enables_bracketed_mode() {
        let (sink, _frames, mut pty_rx) = sink_with_channels();

        sink.write(b"\x1b[?2004h");
        sink.paste(b"hi".to_vec());

        assert_eq!(next_pty_bytes(&mut pty_rx), b"\x1b[200~hi\x1b[201~");
    }

    #[test]
    fn reset_wipes_the_grid_and_repaints() {
        let (sink, frames) = frame_capturing_sink();
        sink.set_subscribed(true);

        sink.write(b"x");
        let mut saw_x = false;
        while let Ok(frame) = frames.recv_timeout(FRAME_WAIT) {
            if &*frame.cells[0].ch == "x" {
                saw_x = true;
                break;
            }
        }
        assert!(saw_x, "the pre-reset grid must show the output");

        sink.reset_terminal();

        let fresh = frames
            .recv_timeout(FRAME_WAIT)
            .expect("reset must push a fresh frame");
        assert_eq!(&*fresh.cells[0].ch, " ", "reset must wipe the grid");
    }

    #[test]
    fn mouse_events_reach_the_pty_only_in_tracking_mode() {
        use mizraj_term::{Mods, MouseAction, MouseButton};

        let (sink, _frames, mut pty_rx) = sink_with_channels();
        let press = MouseInput {
            action: MouseAction::Press,
            button: MouseButton::Left,
            col: 2,
            row: 4,
            mods: Mods {
                ctrl: false,
                alt: false,
                shift: false,
            },
        };

        // Outside tracking mode the event encodes to nothing…
        sink.mouse(press);
        // …then vim-style tracking turns presses into SGR reports.
        sink.write(b"\x1b[?1000h\x1b[?1006h");
        sink.mouse(press);

        assert_eq!(
            next_pty_bytes(&mut pty_rx),
            b"\x1b[<0;3;5M",
            "the first PTY bytes must be the in-mode press (the out-of-mode one sent nothing)"
        );
    }

    #[test]
    fn scrolling_repaints_the_viewport_into_history() {
        let (sink, frames) = frame_capturing_sink();
        sink.set_subscribed(true);

        // Overflow the 24-row default grid so history exists.
        for n in 0..40 {
            sink.write(format!("line{n}\r\n").as_bytes());
        }
        while frames.recv_timeout(Duration::from_millis(200)).is_ok() {}

        sink.scroll(ScrollViewport::Delta(-5));

        let frame = frames
            .recv_timeout(FRAME_WAIT)
            .expect("a viewport move must emit a frame without new output");
        assert_eq!(frame.viewport_top, 5, "viewport sits 5 rows above live");
        assert!(frame.history_total >= 5);

        sink.scroll(ScrollViewport::Bottom);
        let live = frames
            .recv_timeout(FRAME_WAIT)
            .expect("scrolling back to bottom re-emits");
        assert_eq!(live.viewport_top, 0, "bottom re-attaches to live");
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
