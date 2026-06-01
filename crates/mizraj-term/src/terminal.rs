use std::ptr::{self, NonNull};

use mizraj_term_sys::{
    ghostty_terminal_free, ghostty_terminal_new, ghostty_terminal_resize,
    ghostty_terminal_vt_write, GhosttyResult_GHOSTTY_SUCCESS, GhosttyTerminal, GhosttyTerminalImpl,
    GhosttyTerminalOptions,
};

use crate::{Result, TermError};

const DEFAULT_MAX_SCROLLBACK: usize = 10_000;

#[derive(Debug)]
pub struct Terminal {
    handle: NonNull<GhosttyTerminalImpl>,
    rows: u16,
    cols: u16,
}

impl Terminal {
    pub fn new(rows: u16, cols: u16) -> Result<Self> {
        if rows == 0 || cols == 0 {
            return Err(TermError::Init(format!(
                "rows and cols must be non-zero (got rows={rows}, cols={cols})"
            )));
        }

        let options = GhosttyTerminalOptions {
            cols,
            rows,
            max_scrollback: DEFAULT_MAX_SCROLLBACK,
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

        Ok(Self { handle, rows, cols })
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
}
