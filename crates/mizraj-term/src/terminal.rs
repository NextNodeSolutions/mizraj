use std::ptr::{self, NonNull};

use mizraj_term_sys::{
    ghostty_terminal_free, ghostty_terminal_get, ghostty_terminal_mode_get, ghostty_terminal_new,
    ghostty_terminal_reset, ghostty_terminal_resize, ghostty_terminal_scroll_viewport,
    ghostty_terminal_vt_write, GhosttyResult_GHOSTTY_SUCCESS, GhosttyString, GhosttyTerminal,
    GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SCROLLBAR,
    GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_TITLE, GhosttyTerminalImpl, GhosttyTerminalOptions,
    GhosttyTerminalScrollViewport, GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_BOTTOM,
    GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA,
    GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_TOP,
    GhosttyTerminalScrollViewportValue, GhosttyTerminalScrollbar,
};

use crate::device::{drop_callbacks, install_pty_writer, PtyWriter, TerminalCallbacks};
use crate::{Result, TermError};

/// DEC private mode 2004 (bracketed paste), packed per `modes.h`: bits 0–14
/// carry the value, bit 15 is the ANSI flag (0 = DEC private mode).
const MODE_BRACKETED_PASTE: u16 = 2004;

/// The three DEC mouse-tracking modes: normal (1000), button-event (1002),
/// any-event (1003). Any of them active means the program owns the mouse.
const MOUSE_TRACKING_MODES: [u16; 3] = [1000, 1002, 1003];

pub const DEFAULT_MAX_SCROLLBACK_LINES: usize = 10_000;

/// Where to scroll the viewport (the Ghostty scroll actions' vocabulary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrollViewport {
    Top,
    Bottom,
    /// Rows; negative scrolls up into history.
    Delta(isize),
}

/// Viewport position within the scrollable area, in rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollbarState {
    pub total: u64,
    pub offset: u64,
    pub len: u64,
}

pub struct Terminal {
    handle: NonNull<GhosttyTerminalImpl>,
    rows: u16,
    cols: u16,
    // Userdata for the write-pty/device-attributes callbacks; freed AFTER the
    // terminal in Drop so no callback can fire on freed state.
    callbacks: *mut TerminalCallbacks,
}

impl std::fmt::Debug for Terminal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Terminal")
            .field("rows", &self.rows)
            .field("cols", &self.cols)
            .finish_non_exhaustive()
    }
}

impl Terminal {
    pub fn new(rows: u16, cols: u16) -> Result<Self> {
        Self::with_scrollback(rows, cols, DEFAULT_MAX_SCROLLBACK_LINES)
    }

    /// `max_scrollback_lines`: history retention in LINES (the libghostty
    /// option's unit; Ghostty's byte-based scrollback-limit is approximated
    /// by the caller).
    pub fn with_scrollback(rows: u16, cols: u16, max_scrollback_lines: usize) -> Result<Self> {
        if rows == 0 || cols == 0 {
            return Err(TermError::Init(format!(
                "rows and cols must be non-zero (got rows={rows}, cols={cols})"
            )));
        }

        let options = GhosttyTerminalOptions {
            cols,
            rows,
            max_scrollback: max_scrollback_lines,
        };

        let mut raw: GhosttyTerminal = ptr::null_mut();
        // SAFETY: allocator may be NULL (defaults to the platform allocator
        // per the libghostty header); `&mut raw` is a valid stack pointer to
        // receive the out-handle; `options` is fully initialized POD.
        let result = unsafe { ghostty_terminal_new(ptr::null(), &mut raw, options) };

        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Init(format!(
                "ghostty_terminal_new returned result code {result}"
            )));
        }

        let handle = NonNull::new(raw).ok_or_else(|| {
            TermError::Init("ghostty_terminal_new succeeded but returned NULL handle".into())
        })?;

        Ok(Self {
            handle,
            rows,
            cols,
            callbacks: std::ptr::null_mut(),
        })
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    pub fn cols(&self) -> u16 {
        self.cols
    }

    /// Resize the grid to `rows` x `cols`, reflowing the primary screen when
    /// wraparound is enabled. Must be kept in lockstep with the PTY size: the
    /// child reflows its output to the PTY's columns, so this emulator has to
    /// parse those bytes at the same width or the grid scatters.
    ///
    /// Cell pixel dimensions are passed as 0 — they only feed image protocols
    /// and mode-2048 size reports, which this VT-only render path does not use.
    pub fn resize(&mut self, rows: u16, cols: u16) -> Result<()> {
        if rows == 0 || cols == 0 {
            return Err(TermError::Resize(format!(
                "rows and cols must be non-zero (got rows={rows}, cols={cols})"
            )));
        }
        // SAFETY: `self.handle` is a live handle from `ghostty_terminal_new`
        // (Drop hasn't run, guaranteed by `&mut self`). `cols`/`rows` are
        // non-zero as the header requires; the two pixel args are plain u32.
        let result = unsafe { ghostty_terminal_resize(self.handle.as_ptr(), cols, rows, 0, 0) };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Resize(format!(
                "ghostty_terminal_resize returned result code {result}"
            )));
        }
        self.rows = rows;
        self.cols = cols;
        Ok(())
    }

    /// Feed VT bytes; infallible per libghostty (Result kept for API symmetry).
    pub fn feed(&mut self, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        // SAFETY: `self.handle` is a live handle from `ghostty_terminal_new`
        // (Drop hasn't run yet, guaranteed by `&mut self`); `data.as_ptr()`
        // + `data.len()` describe a valid initialized byte region for the
        // duration of the call.
        unsafe {
            ghostty_terminal_vt_write(self.handle.as_ptr(), data.as_ptr(), data.len());
        }
        Ok(())
    }

    /// Install the PTY write-back (TP14): libghostty then answers DSR/DA/ENQ
    /// queries by handing the response bytes to `writer` — synchronously,
    /// during `feed`, on the thread that owns this terminal. DA queries get
    /// Ghostty's device identity (VT220 + ANSI color). Installing twice
    /// replaces the previous writer.
    pub fn set_pty_writer(&mut self, writer: PtyWriter) -> Result<()> {
        let userdata = install_pty_writer(self.handle, writer)?;
        let previous = self.callbacks;
        self.callbacks = userdata;
        // The old state (if any) is no longer referenced by the terminal:
        // OPT_USERDATA now points at the new box.
        drop_callbacks(previous);
        Ok(())
    }

    /// The title the running program set via OSC 0/2, when any.
    pub fn title(&self) -> Result<Option<String>> {
        let mut raw = GhosttyString {
            ptr: std::ptr::null(),
            len: 0,
        };
        // SAFETY: live handle (&self); out pointer targets a local of the
        // exact type DATA_TITLE documents. The returned string is borrowed —
        // copied to an owned String before the next feed can invalidate it.
        let result = unsafe {
            ghostty_terminal_get(
                self.handle.as_ptr(),
                GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_TITLE,
                (&raw mut raw).cast(),
            )
        };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Mode(format!(
                "ghostty_terminal_get(title) returned {result}"
            )));
        }
        if raw.ptr.is_null() || raw.len == 0 {
            return Ok(None);
        }
        // SAFETY: ptr/len come from libghostty and are valid until the next
        // vt_write/reset; we copy immediately.
        let bytes = unsafe { std::slice::from_raw_parts(raw.ptr, raw.len) };
        Ok(Some(String::from_utf8_lossy(bytes).into_owned()))
    }

    /// Full terminal reset (the Ghostty `reset` keybind action): wipes
    /// screen contents, scrollback, modes and styles back to boot state. The
    /// child process is not signaled — exactly like Ghostty, the next program
    /// output simply draws onto the fresh grid.
    pub fn reset(&mut self) {
        // SAFETY: `self.handle` is a live handle from `ghostty_terminal_new`
        // (Drop hasn't run yet, guaranteed by `&mut self`).
        unsafe { ghostty_terminal_reset(self.handle.as_ptr()) };
    }

    /// Whether the running program switched bracketed-paste mode on (DEC
    /// 2004). Pasted text must then be wrapped in `ESC[200~ … ESC[201~` so
    /// the child can tell a paste from typed input.
    pub fn bracketed_paste(&self) -> Result<bool> {
        self.mode(MODE_BRACKETED_PASTE)
    }

    /// Reposition the viewport over the scrollback. New output keeps landing
    /// in the active area; the viewport stays where it was put until scrolled
    /// back to [`ScrollViewport::Bottom`].
    pub fn scroll_viewport(&mut self, to: ScrollViewport) {
        let behavior = match to {
            ScrollViewport::Top => GhosttyTerminalScrollViewport {
                tag: GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_TOP,
                value: GhosttyTerminalScrollViewportValue { _padding: [0; 2] },
            },
            ScrollViewport::Bottom => GhosttyTerminalScrollViewport {
                tag: GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_BOTTOM,
                value: GhosttyTerminalScrollViewportValue { _padding: [0; 2] },
            },
            ScrollViewport::Delta(rows) => GhosttyTerminalScrollViewport {
                tag: GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA,
                value: GhosttyTerminalScrollViewportValue { delta: rows },
            },
        };
        // SAFETY: live handle (&mut self); `behavior` is a fully initialized
        // POD passed by value.
        unsafe { ghostty_terminal_scroll_viewport(self.handle.as_ptr(), behavior) };
    }

    /// Where the viewport sits in the scrollable area (rows). `offset` grows
    /// downward from the top of history; the viewport is live when
    /// `offset + len == total`.
    pub fn scrollbar(&self) -> Result<ScrollbarState> {
        let mut raw = GhosttyTerminalScrollbar {
            total: 0,
            offset: 0,
            len: 0,
        };
        // SAFETY: live handle (&self); out pointer targets a local struct of
        // the exact type the SCROLLBAR data type documents.
        let result = unsafe {
            ghostty_terminal_get(
                self.handle.as_ptr(),
                GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SCROLLBAR,
                (&raw mut raw).cast(),
            )
        };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Mode(format!(
                "ghostty_terminal_get(scrollbar) returned {result}"
            )));
        }
        Ok(ScrollbarState {
            total: raw.total,
            offset: raw.offset,
            len: raw.len,
        })
    }

    /// Whether any mouse-tracking mode is active — the program (vim, htop)
    /// wants mouse events encoded to the PTY instead of local selection.
    pub fn mouse_tracking(&self) -> Result<bool> {
        for mode in MOUSE_TRACKING_MODES {
            if self.mode(mode)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn mode(&self, mode: u16) -> Result<bool> {
        let mut value = false;
        // SAFETY: `self.handle` is a live handle from `ghostty_terminal_new`
        // (Drop hasn't run yet, guaranteed by `&self`); the out pointer
        // targets a local that outlives the call.
        let result = unsafe { ghostty_terminal_mode_get(self.handle.as_ptr(), mode, &mut value) };
        if result != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Mode(format!(
                "ghostty_terminal_mode_get({mode}) returned {result}"
            )));
        }
        Ok(value)
    }

    /// Raw handle for FFI calls that need the terminal pointer (RenderState).
    pub(crate) fn raw_handle(&self) -> *mut GhosttyTerminalImpl {
        self.handle.as_ptr()
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        // SAFETY: `self.handle` was obtained from `ghostty_terminal_new`,
        // has not been freed before (Drop runs at most once), and is not
        // observed after this call (the Terminal is being destroyed).
        unsafe { ghostty_terminal_free(self.handle.as_ptr()) };
        // Free the callback state only after the terminal is gone: callbacks
        // fire during vt_write, which can no longer happen.
        drop_callbacks(self.callbacks);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_updates_reported_dimensions() {
        let mut terminal = Terminal::new(24, 80).expect("new 24x80 terminal");

        terminal.resize(40, 120).expect("resize to 40x120");

        assert_eq!(terminal.rows(), 40);
        assert_eq!(terminal.cols(), 120);
    }

    #[test]
    fn resize_to_zero_dimension_is_rejected() {
        let mut terminal = Terminal::new(24, 80).expect("new 24x80 terminal");

        let err = terminal
            .resize(0, 80)
            .expect_err("zero rows must be rejected");

        assert!(matches!(err, TermError::Resize(_)));
        // The failed resize must not corrupt the live dimensions.
        assert_eq!(terminal.rows(), 24);
        assert_eq!(terminal.cols(), 80);
    }

    #[test]
    fn dsr_query_round_trips_through_the_pty_writer() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let mut terminal = Terminal::new(24, 80).expect("terminal");
        let written: Rc<RefCell<Vec<u8>>> = Rc::default();
        let sink = Rc::clone(&written);
        terminal
            .set_pty_writer(Box::new(move |bytes| {
                sink.borrow_mut().extend_from_slice(bytes);
            }))
            .expect("install writer");

        // DSR cursor position (CSI 6 n) -> CSI 1;1R from the home position.
        terminal.feed(b"\x1b[6n").expect("feed DSR");
        assert_eq!(written.borrow().as_slice(), b"\x1b[1;1R");

        // DA1 (CSI c) -> VT220 identity with our feature set.
        written.borrow_mut().clear();
        terminal.feed(b"\x1b[c").expect("feed DA1");
        assert_eq!(written.borrow().as_slice(), b"\x1b[?62;22;52c");
    }

    #[test]
    fn osc_title_is_readable_and_resets() {
        let mut terminal = Terminal::new(24, 80).expect("terminal");
        assert_eq!(terminal.title().expect("no title yet"), None);

        terminal.feed(b"\x1b]2;mon-titre\x07").expect("feed OSC 2");
        assert_eq!(
            terminal.title().expect("title set"),
            Some("mon-titre".to_string())
        );

        terminal.feed(b"\x1b]2;\x07").expect("feed empty title");
        assert_eq!(terminal.title().expect("title cleared"), None);
    }

    #[test]
    fn reset_restores_boot_state() {
        let mut terminal = Terminal::new(24, 80).expect("new terminal");
        terminal.feed(b"\x1b[?2004h").expect("set bracketed paste");
        assert!(terminal.bracketed_paste().expect("query on"));

        terminal.reset();

        assert!(
            !terminal.bracketed_paste().expect("query after reset"),
            "reset must clear DEC private modes"
        );
        assert_eq!(terminal.rows(), 24);
        assert_eq!(terminal.cols(), 80);
    }

    #[test]
    fn scrollback_viewport_repositions_and_reports() {
        let mut terminal = Terminal::new(4, 10).expect("terminal");
        // 12 lines on a 4-row grid -> 8 rows of history.
        for n in 0..12 {
            terminal
                .feed(format!("line{n}\r\n").as_bytes())
                .expect("feed line");
        }

        let live = terminal.scrollbar().expect("scrollbar");
        assert_eq!(live.offset + live.len, live.total, "starts live");
        assert!(live.total > u64::from(terminal.rows()), "history exists");

        terminal.scroll_viewport(ScrollViewport::Delta(-3));
        let scrolled = terminal.scrollbar().expect("scrollbar after delta");
        assert_eq!(scrolled.offset + 3, live.offset, "moved 3 rows up");

        terminal.scroll_viewport(ScrollViewport::Bottom);
        let back = terminal.scrollbar().expect("scrollbar at bottom");
        assert_eq!(back.offset + back.len, back.total, "re-attached to live");
    }

    #[test]
    fn mouse_tracking_follows_any_tracking_mode() {
        let mut terminal = Terminal::new(24, 80).expect("new terminal");
        assert!(!terminal.mouse_tracking().expect("query off"));

        terminal.feed(b"\x1b[?1002h").expect("set button tracking");
        assert!(terminal.mouse_tracking().expect("query on"));

        terminal.feed(b"\x1b[?1002l").expect("reset");
        assert!(!terminal.mouse_tracking().expect("query off again"));
    }

    #[test]
    fn bracketed_paste_follows_the_vt_stream() {
        let mut terminal = Terminal::new(24, 80).expect("new terminal");
        assert!(!terminal.bracketed_paste().expect("query off"));

        terminal.feed(b"\x1b[?2004h").expect("set 2004");
        assert!(terminal.bracketed_paste().expect("query on"));

        terminal.feed(b"\x1b[?2004l").expect("reset 2004");
        assert!(!terminal.bracketed_paste().expect("query off again"));
    }
}
