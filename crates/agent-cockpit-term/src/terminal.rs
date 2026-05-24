use std::ffi::c_void;
use std::mem::MaybeUninit;
use std::ptr::{self, NonNull};

use agent_cockpit_term_sys::{
    ghostty_cell_get, ghostty_grid_ref_cell, ghostty_terminal_free, ghostty_terminal_grid_ref,
    ghostty_terminal_new, ghostty_terminal_vt_write, GhosttyCell,
    GhosttyCellData_GHOSTTY_CELL_DATA_CODEPOINT, GhosttyGridRef, GhosttyPoint,
    GhosttyPointCoordinate, GhosttyPointTag_GHOSTTY_POINT_TAG_ACTIVE, GhosttyPointValue,
    GhosttyResult_GHOSTTY_SUCCESS, GhosttyTerminal, GhosttyTerminalImpl, GhosttyTerminalOptions,
};

use crate::{Attrs, Cell, Cells, Color, Result, TermError};

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

    /// Snapshot the active grid into an owned `Cells` buffer.
    ///
    /// Allocates a fresh `Vec<Cell>` of size `rows * cols` on every call;
    /// callers that frame-stream should reuse buffers (post-V1 optimization,
    /// likely backed by the render-state API).
    ///
    /// Cells fall back to a space character (`' '`) with default styling
    /// when libghostty reports no codepoint or a non-success status for a
    /// given position; this matches an empty/blank terminal cell.
    pub fn cells(&self) -> Cells {
        let total = (self.rows as usize) * (self.cols as usize);
        let mut data = Vec::with_capacity(total);

        for row in 0..self.rows {
            for col in 0..self.cols {
                data.push(Cell {
                    ch: self.cell_codepoint(row, col),
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                });
            }
        }

        Cells {
            rows: self.rows,
            cols: self.cols,
            data,
        }
    }

    fn cell_codepoint(&self, row: u16, col: u16) -> char {
        let point = GhosttyPoint {
            tag: GhosttyPointTag_GHOSTTY_POINT_TAG_ACTIVE,
            value: GhosttyPointValue {
                coordinate: GhosttyPointCoordinate {
                    x: col,
                    y: row as u32,
                },
            },
        };

        let mut grid_ref = MaybeUninit::<GhosttyGridRef>::uninit();
        // SAFETY: `self.handle` is live (Drop bound to `&self`); `point` is
        // fully initialized POD with the `coordinate` union variant set to
        // match the ACTIVE tag; `grid_ref.as_mut_ptr()` is a valid writable
        // pointer to stack storage.
        let r = unsafe {
            ghostty_terminal_grid_ref(self.handle.as_ptr(), point, grid_ref.as_mut_ptr())
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return ' ';
        }
        // SAFETY: libghostty returned GHOSTTY_SUCCESS, which per the header
        // contract means `out_ref` was fully written.
        let grid_ref = unsafe { grid_ref.assume_init() };

        let mut cell: GhosttyCell = 0;
        // SAFETY: `&grid_ref` points to a valid `GhosttyGridRef` initialized
        // above; the snapshot is still fresh (no mutating terminal call has
        // happened since); `&mut cell` is a valid pointer to a u64.
        let r = unsafe { ghostty_grid_ref_cell(&grid_ref, &mut cell) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return ' ';
        }

        let mut codepoint: u32 = 0;
        // SAFETY: `cell` is passed by value; the codepoint data kind requires
        // a `uint32_t*` output, which matches `&mut codepoint`.
        let r = unsafe {
            ghostty_cell_get(
                cell,
                GhosttyCellData_GHOSTTY_CELL_DATA_CODEPOINT,
                (&mut codepoint as *mut u32).cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS || codepoint == 0 {
            return ' ';
        }
        char::from_u32(codepoint).unwrap_or(' ')
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
    fn feed_accepts_arbitrary_bytes() {
        // Type-level guarantee: any &[u8] is valid (incl. invalid UTF-8).
        let _: fn(&mut Terminal, &[u8]) -> Result<()> = Terminal::feed;
    }

    #[test]
    fn cells_returns_owned_cells_snapshot() {
        // Type-level guarantee: cells() takes &self and returns an owned Cells.
        let _: fn(&Terminal) -> Cells = Terminal::cells;
    }
}
