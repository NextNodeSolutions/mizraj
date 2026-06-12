use mizraj_term::{MouseInput, ScrollViewport};

use crate::session::cell_frame::CellFrame;
use crate::session::key::KeyStroke;

/// Reply channel for an on-demand frame snapshot (TP1). Capacity 1: the
/// terminal sink's render thread `try_send`s exactly one frame, the requesting
/// command awaits it with a timeout.
pub type FrameReply = tauri::async_runtime::Sender<CellFrame>;

/// Per-session terminal endpoint: the PTY reader fans out every output chunk to
/// all registered sinks (D4: channel sink for the live UI, scrollback sink for
/// replay, etc.), and the same fan-out carries control input — [`resize`] and
/// [`key`] — to whichever sink owns the terminal emulator.
///
/// Implementations MUST NOT block longer than ~1ms inside [`write`]; anything
/// slower backs up the PTY reader and risks dropping or stalling output.
/// Move heavy work (I/O, large allocations, cross-thread coordination) onto a
/// dedicated task and hand it bytes through a non-blocking channel.
pub trait OutputSink: Send + Sync {
    fn write(&self, bytes: &[u8]);

    /// Called when the frontend resizes the pane, BEFORE the PTY is resized,
    /// so a render-side terminal emulator can match the geometry the child is
    /// about to reflow into. `rows`/`cols` are the new grid dimensions. Same
    /// ~1ms budget as [`write`]. Default no-op: byte-only sinks (the raw
    /// `agent:output` sink, scrollback, tests) carry no grid and ignore it.
    fn resize(&self, _rows: u16, _cols: u16) {}

    /// Called exactly once when the session's child process terminates,
    /// carrying the observed exit code (D8: auto-open the diff at end of run).
    ///
    /// Same ~1ms budget as [`write`] — move heavy work off-thread. Default
    /// no-op so output-only sinks (scrollback, tests) need not react to
    /// termination.
    fn end(&self, _exit_code: u32) {}

    /// Called when the frontend sends a key press. Like [`resize`], this is
    /// control INPUT routed through the same fan-out: only the terminal sink
    /// consumes it (VT-encoding the stroke against the live terminal modes and
    /// writing it to the PTY); byte-only sinks ignore it. Same ~1ms budget —
    /// the encode itself happens off-thread on the render thread.
    fn key(&self, _stroke: KeyStroke) {}

    /// Called when a frontend pane starts (`true`) or stops (`false`) watching
    /// the session (TP3). Only the terminal sink reacts — it gates cell-frame
    /// emission so an unwatched session costs no snapshot/serialize/IPC work;
    /// byte-only sinks keep their default no-op. Same ~1ms budget.
    fn set_subscribed(&self, _subscribed: bool) {}

    /// Called when the frontend pulls the current grid on mount (TP1). Only
    /// the terminal sink replies — its render thread serializes the live grid
    /// into the reply channel; byte-only sinks keep the default no-op and the
    /// caller's timeout handles a session with no terminal sink. Same ~1ms
    /// budget: the snapshot itself happens on the render thread.
    fn frame_request(&self, _reply: FrameReply) {}

    /// Called when the user triggers the Ghostty `reset` keybind action. Only
    /// the terminal sink acts: its render thread resets the emulator to boot
    /// state and pushes a fresh frame. The child process is not signaled.
    fn reset_terminal(&self) {}

    /// Called when the frontend forwards a mouse event (TP10). Only the
    /// terminal sink acts: its render thread encodes against the live
    /// mouse-tracking mode and writes to the PTY — or nothing, outside any
    /// tracking mode. Same ~1ms budget.
    fn mouse(&self, _input: MouseInput) {}

    /// Called when the user scrolls the viewport (wheel outside app mouse
    /// mode, scroll keybinds — TP6). Only the terminal sink acts: its render
    /// thread repositions the window over the scrollback and repaints.
    fn scroll(&self, _to: ScrollViewport) {}

    /// Called when the user pastes into the session (TP7/TP8). Only the
    /// terminal sink acts: its render thread encodes the payload against the
    /// live bracketed-paste mode (strip unsafe bytes, wrap in `ESC[200~ …` or
    /// convert newlines) and writes the result to the PTY. Same ~1ms budget —
    /// the encode happens off-thread.
    fn paste(&self, _data: Vec<u8>) {}
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Mutex;

    use super::OutputSink;

    pub struct VecSink(Mutex<Vec<u8>>);

    impl VecSink {
        pub fn new() -> Self {
            Self(Mutex::new(Vec::new()))
        }

        pub fn snapshot(&self) -> Vec<u8> {
            self.0.lock().expect("VecSink mutex poisoned").clone()
        }
    }

    impl Default for VecSink {
        fn default() -> Self {
            Self::new()
        }
    }

    impl OutputSink for VecSink {
        fn write(&self, bytes: &[u8]) {
            self.0
                .lock()
                .expect("VecSink mutex poisoned")
                .extend_from_slice(bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::test_support::VecSink;
    use super::OutputSink;

    #[test]
    fn vec_sink_records_writes_in_order() {
        let sink = VecSink::new();
        sink.write(b"hello ");
        sink.write(b"world");
        assert_eq!(sink.snapshot(), b"hello world");
    }

    #[test]
    fn fan_out_through_arc_dyn_sinks() {
        let a = Arc::new(VecSink::new());
        let b = Arc::new(VecSink::new());
        let sinks: Vec<Arc<dyn OutputSink>> = vec![
            Arc::clone(&a) as Arc<dyn OutputSink>,
            Arc::clone(&b) as Arc<dyn OutputSink>,
        ];

        for sink in &sinks {
            sink.write(b"chunk");
        }

        assert_eq!(a.snapshot(), b"chunk");
        assert_eq!(b.snapshot(), b"chunk");
    }
}
