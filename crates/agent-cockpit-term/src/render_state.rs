use std::ffi::c_void;
use std::mem;
use std::ptr::{self, NonNull};

use agent_cockpit_term_sys::{
    ghostty_render_state_free, ghostty_render_state_get, ghostty_render_state_new,
    ghostty_render_state_row_cells_free, ghostty_render_state_row_cells_get,
    ghostty_render_state_row_cells_new, ghostty_render_state_row_cells_next,
    ghostty_render_state_row_get, ghostty_render_state_row_iterator_free,
    ghostty_render_state_row_iterator_new, ghostty_render_state_row_iterator_next,
    ghostty_render_state_set, ghostty_render_state_update, GhosttyRenderState,
    GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_COLS,
    GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_DIRTY,
    GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROWS,
    GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
    GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FALSE,
    GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FULL,
    GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_PARTIAL, GhosttyRenderStateImpl,
    GhosttyRenderStateOption_GHOSTTY_RENDER_STATE_OPTION_DIRTY, GhosttyRenderStateRowCells,
    GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF,
    GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN,
    GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE,
    GhosttyRenderStateRowCellsImpl, GhosttyRenderStateRowData_GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
    GhosttyRenderStateRowIterator, GhosttyRenderStateRowIteratorImpl,
    GhosttyResult_GHOSTTY_SUCCESS, GhosttyStyle, GhosttyStyleColor,
    GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_PALETTE, GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_RGB,
};

use crate::{Attrs, Cell, Cells, Color, Result, TermError, Terminal};

/// Stack-allocated grapheme buffer cap. Cells with more grapheme codepoints
/// than this collapse to the base codepoint only; covers the vast majority
/// of realistic terminal cells (single base + 0-2 combining marks).
const MAX_GRAPHEMES_PER_CELL: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dirty {
    /// Nothing changed since the last `update`. Callers should reuse the
    /// previous frame and skip snapshotting entirely.
    Clean,
    /// Some rows changed; renderer may redraw incrementally.
    Partial,
    /// Global state changed; renderer should redraw everything.
    Full,
}

/// Persistent render state attached to a terminal.
///
/// `RenderState` is the supported way to read the terminal grid for rendering.
/// It is stateful and optimized for repeated frames: the libghostty render
/// state internally tracks dirty regions, and `update` resets that bookkeeping
/// to feed the next frame. Allocate once per terminal, reuse for every frame.
///
/// See `vendor/include/ghostty/vt/render.h` for the underlying C API contract.
#[derive(Debug)]
pub struct RenderState {
    handle: NonNull<GhosttyRenderStateImpl>,
    row_iter: NonNull<GhosttyRenderStateRowIteratorImpl>,
    row_cells: NonNull<GhosttyRenderStateRowCellsImpl>,
}

impl RenderState {
    pub fn new() -> Result<Self> {
        let mut raw_state: GhosttyRenderState = ptr::null_mut();
        // SAFETY: allocator may be NULL (defaults to the platform allocator);
        // `&mut raw_state` is a valid stack pointer to receive the out-handle.
        let r = unsafe { ghostty_render_state_new(ptr::null(), &mut raw_state) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Init(format!(
                "ghostty_render_state_new returned {r}"
            )));
        }
        let handle = NonNull::new(raw_state)
            .ok_or_else(|| TermError::Init("ghostty_render_state_new returned NULL".into()))?;

        let mut raw_iter: GhosttyRenderStateRowIterator = ptr::null_mut();
        // SAFETY: allocator NULL = default; `&mut raw_iter` is a valid out
        // pointer. If this fails we still hold `handle` and must free it.
        let r = unsafe { ghostty_render_state_row_iterator_new(ptr::null(), &mut raw_iter) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            // SAFETY: `handle` was just created above and not exposed.
            unsafe { ghostty_render_state_free(handle.as_ptr()) };
            return Err(TermError::Init(format!(
                "ghostty_render_state_row_iterator_new returned {r}"
            )));
        }
        let row_iter = match NonNull::new(raw_iter) {
            Some(p) => p,
            None => {
                // SAFETY: same as above.
                unsafe { ghostty_render_state_free(handle.as_ptr()) };
                return Err(TermError::Init(
                    "ghostty_render_state_row_iterator_new returned NULL".into(),
                ));
            }
        };

        let mut raw_cells: GhosttyRenderStateRowCells = ptr::null_mut();
        // SAFETY: same allocator and out-pointer contract as above.
        let r = unsafe { ghostty_render_state_row_cells_new(ptr::null(), &mut raw_cells) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            // SAFETY: both handles created above, not exposed.
            unsafe {
                ghostty_render_state_row_iterator_free(row_iter.as_ptr());
                ghostty_render_state_free(handle.as_ptr());
            }
            return Err(TermError::Init(format!(
                "ghostty_render_state_row_cells_new returned {r}"
            )));
        }
        let row_cells = match NonNull::new(raw_cells) {
            Some(p) => p,
            None => {
                // SAFETY: same as above.
                unsafe {
                    ghostty_render_state_row_iterator_free(row_iter.as_ptr());
                    ghostty_render_state_free(handle.as_ptr());
                }
                return Err(TermError::Init(
                    "ghostty_render_state_row_cells_new returned NULL".into(),
                ));
            }
        };

        Ok(Self {
            handle,
            row_iter,
            row_cells,
        })
    }

    /// Pull the latest dirty state from `term` into this render state.
    ///
    /// Takes `&mut Terminal` because libghostty consumes the terminal's
    /// internal dirty bookkeeping during this call (see `render.h`). Callers
    /// should pair `update` with `mark_clean` after rendering the frame.
    pub fn update(&mut self, term: &mut Terminal) -> Result<Dirty> {
        // SAFETY: both handles are live (Drop bound to `&mut self` / `&mut term`).
        let r = unsafe { ghostty_render_state_update(self.handle.as_ptr(), term.raw_handle()) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_update returned {r}"
            )));
        }
        self.read_dirty()
    }

    /// Current dirty state without re-pulling from the terminal.
    pub fn dirty(&self) -> Result<Dirty> {
        self.read_dirty()
    }

    /// Reset the global dirty state to FALSE so the next `update` only
    /// reports changes that happen from this point on.
    pub fn mark_clean(&mut self) -> Result<()> {
        let value: u32 = GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FALSE;
        // SAFETY: handle is live; OPTION_DIRTY expects a `GhosttyRenderStateDirty`
        // (a u32 enum per the bindgen-generated type) which is what `value`
        // provides.
        let r = unsafe {
            ghostty_render_state_set(
                self.handle.as_ptr(),
                GhosttyRenderStateOption_GHOSTTY_RENDER_STATE_OPTION_DIRTY,
                (&value as *const u32).cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_set(DIRTY=FALSE) returned {r}"
            )));
        }
        Ok(())
    }

    /// Returns `(rows, cols)` of the current render state viewport.
    pub fn dimensions(&self) -> Result<(u16, u16)> {
        let mut cols: u16 = 0;
        // SAFETY: handle is live; COLS expects a `uint16_t*` output.
        let r = unsafe {
            ghostty_render_state_get(
                self.handle.as_ptr(),
                GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_COLS,
                (&mut cols as *mut u16).cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_get(COLS) returned {r}"
            )));
        }
        let mut rows: u16 = 0;
        // SAFETY: handle is live; ROWS expects a `uint16_t*` output.
        let r = unsafe {
            ghostty_render_state_get(
                self.handle.as_ptr(),
                GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROWS,
                (&mut rows as *mut u16).cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_get(ROWS) returned {r}"
            )));
        }
        Ok((rows, cols))
    }

    /// Walk the render state and build an owned `Cells` snapshot.
    ///
    /// Callers should check `dirty()` first and skip this when the state is
    /// `Dirty::Clean` — that's the whole point of the dirty-tracking API.
    pub fn snapshot(&mut self) -> Result<Cells> {
        let (rows, cols) = self.dimensions()?;
        let mut data: Vec<Cell> = Vec::with_capacity((rows as usize) * (cols as usize));

        // SAFETY: handle is live; ROW_ITERATOR populates the pre-allocated
        // row_iter struct (the pointer's pointee state changes; the pointer
        // itself does not). Same contract for the cells handle below.
        let r = unsafe {
            ghostty_render_state_get(
                self.handle.as_ptr(),
                GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
                self.row_iter.as_ptr().cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_get(ROW_ITERATOR) returned {r}"
            )));
        }

        let mut row_count: u16 = 0;
        // SAFETY: row_iter handle is live and was just populated.
        while unsafe { ghostty_render_state_row_iterator_next(self.row_iter.as_ptr()) } {
            row_count += 1;

            // SAFETY: row_iter positioned on a valid row by the next() above;
            // ROW_DATA_CELLS populates the pre-allocated row_cells struct.
            let r = unsafe {
                ghostty_render_state_row_get(
                    self.row_iter.as_ptr(),
                    GhosttyRenderStateRowData_GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                    self.row_cells.as_ptr().cast::<c_void>(),
                )
            };
            if r != GhosttyResult_GHOSTTY_SUCCESS {
                return Err(TermError::Feed(format!(
                    "ghostty_render_state_row_get(CELLS) returned {r}"
                )));
            }

            let mut col_count: u16 = 0;
            // SAFETY: row_cells handle is live, was just populated for this row.
            while unsafe { ghostty_render_state_row_cells_next(self.row_cells.as_ptr()) } {
                // Degrade per-cell FFI errors to a blank instead of aborting the
                // whole frame: a transient libghostty hiccup on one cell (e.g.
                // mid-resize) should drop one glyph, not the entire terminal.
                let cell =
                    read_current_cell(self.row_cells.as_ptr()).unwrap_or_else(|_| blank_cell());
                data.push(cell);
                col_count += 1;
                if col_count >= cols {
                    break;
                }
            }
            // Defensive: if the row exposed fewer cells than `cols`, fill the
            // tail with blanks so the returned grid is rectangular.
            while col_count < cols {
                data.push(blank_cell());
                col_count += 1;
            }
            if row_count >= rows {
                break;
            }
        }
        while row_count < rows {
            for _ in 0..cols {
                data.push(blank_cell());
            }
            row_count += 1;
        }

        Ok(Cells { rows, cols, data })
    }

    fn read_dirty(&self) -> Result<Dirty> {
        let mut value: u32 = 0;
        // SAFETY: handle is live; DIRTY expects a `GhosttyRenderStateDirty`
        // output (a u32 enum per the bindgen-generated type).
        let r = unsafe {
            ghostty_render_state_get(
                self.handle.as_ptr(),
                GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_DIRTY,
                (&mut value as *mut u32).cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "ghostty_render_state_get(DIRTY) returned {r}"
            )));
        }
        Ok(match value {
            v if v == GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FALSE => Dirty::Clean,
            v if v == GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_PARTIAL => Dirty::Partial,
            v if v == GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FULL => Dirty::Full,
            other => {
                return Err(TermError::Feed(format!(
                    "unexpected GhosttyRenderStateDirty value {other}"
                )));
            }
        })
    }
}

impl Drop for RenderState {
    fn drop(&mut self) {
        // SAFETY: handles obtained from `ghostty_render_state_*_new`, not
        // freed before (Drop runs at most once), not observed after.
        // Free in reverse-creation order so the row cells/iter are released
        // before the parent render state.
        unsafe {
            ghostty_render_state_row_cells_free(self.row_cells.as_ptr());
            ghostty_render_state_row_iterator_free(self.row_iter.as_ptr());
            ghostty_render_state_free(self.handle.as_ptr());
        }
    }
}

fn read_current_cell(cells: GhosttyRenderStateRowCells) -> Result<Cell> {
    let ch = read_codepoint(cells)?;
    let (fg, bg, attrs) = read_style(cells)?;
    Ok(Cell { ch, fg, bg, attrs })
}

fn read_codepoint(cells: GhosttyRenderStateRowCells) -> Result<char> {
    let mut len: u32 = 0;
    // SAFETY: `cells` is positioned on a valid cell by the caller; GRAPHEMES_LEN
    // expects a `uint32_t*` output.
    let r = unsafe {
        ghostty_render_state_row_cells_get(
            cells,
            GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN,
            (&mut len as *mut u32).cast::<c_void>(),
        )
    };
    if r != GhosttyResult_GHOSTTY_SUCCESS {
        return Err(TermError::Feed(format!(
            "row_cells_get(GRAPHEMES_LEN) returned {r}"
        )));
    }
    if len == 0 {
        return Ok(' ');
    }
    let len = len as usize;

    let base = if len <= MAX_GRAPHEMES_PER_CELL {
        let mut buf = [0u32; MAX_GRAPHEMES_PER_CELL];
        // SAFETY: `buf` holds at least `len` u32s (len <= MAX_GRAPHEMES_PER_CELL);
        // GRAPHEMES_BUF writes exactly `len` codepoints into the pointer.
        let r = unsafe {
            ghostty_render_state_row_cells_get(
                cells,
                GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF,
                buf.as_mut_ptr().cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "row_cells_get(GRAPHEMES_BUF) returned {r}"
            )));
        }
        buf[0]
    } else {
        let mut buf: Vec<u32> = vec![0; len];
        // SAFETY: `buf` holds exactly `len` u32s; GRAPHEMES_BUF writes exactly
        // `len` codepoints into the pointer.
        let r = unsafe {
            ghostty_render_state_row_cells_get(
                cells,
                GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF,
                buf.as_mut_ptr().cast::<c_void>(),
            )
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Feed(format!(
                "row_cells_get(GRAPHEMES_BUF) returned {r}"
            )));
        }
        buf[0]
    };
    Ok(char::from_u32(base).unwrap_or(' '))
}

fn read_style(cells: GhosttyRenderStateRowCells) -> Result<(Color, Color, Attrs)> {
    // `GhosttyStyle` is a sized struct (style.h): caller must set `size`
    // before the call. Tag-0 (`GHOSTTY_STYLE_COLOR_NONE`) is a valid initial
    // tag per style.h, so all-zero init is sound.
    // SAFETY: `GhosttyStyle` is POD (size_t + tagged unions over POD + bools
    // + int); all-zero is a valid initial state.
    let mut style: GhosttyStyle = unsafe { mem::zeroed() };
    style.size = mem::size_of::<GhosttyStyle>();

    // SAFETY: `cells` is positioned on a valid cell; STYLE expects a
    // `GhosttyStyle*` output with a pre-set `size` field.
    let r = unsafe {
        ghostty_render_state_row_cells_get(
            cells,
            GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE,
            (&mut style as *mut GhosttyStyle).cast::<c_void>(),
        )
    };
    if r != GhosttyResult_GHOSTTY_SUCCESS {
        return Err(TermError::Feed(format!(
            "row_cells_get(STYLE) returned {r}"
        )));
    }

    let mut attrs = Attrs::empty();
    attrs.set(Attrs::BOLD, style.bold);
    attrs.set(Attrs::ITALIC, style.italic);
    attrs.set(Attrs::UNDERLINE, style.underline != 0);
    attrs.set(Attrs::REVERSE, style.inverse);
    attrs.set(Attrs::DIM, style.faint);
    attrs.set(Attrs::STRIKE, style.strikethrough);

    Ok((
        style_color_to_color(style.fg_color),
        style_color_to_color(style.bg_color),
        attrs,
    ))
}

fn style_color_to_color(c: GhosttyStyleColor) -> Color {
    #[allow(non_upper_case_globals)] // bindgen-generated constant names
    match c.tag {
        GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_PALETTE => {
            // SAFETY: tag PALETTE means the `palette` arm of the union is active.
            Color::Indexed(unsafe { c.value.palette })
        }
        GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_RGB => {
            // SAFETY: tag RGB means the `rgb` arm is active.
            let rgb = unsafe { c.value.rgb };
            Color::Rgb(rgb.r, rgb.g, rgb.b)
        }
        _ => Color::Default,
    }
}

fn blank_cell() -> Cell {
    Cell {
        ch: ' ',
        fg: Color::Default,
        bg: Color::Default,
        attrs: Attrs::empty(),
    }
}
