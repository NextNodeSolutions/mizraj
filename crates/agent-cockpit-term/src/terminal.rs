use std::ffi::c_void;
use std::mem;
use std::ptr::{self, NonNull};

use agent_cockpit_term_sys::{
    ghostty_cell_get, ghostty_grid_ref_cell, ghostty_grid_ref_style, ghostty_terminal_free,
    ghostty_terminal_grid_ref, ghostty_terminal_new, ghostty_terminal_vt_write, GhosttyCell,
    GhosttyCellData_GHOSTTY_CELL_DATA_CODEPOINT, GhosttyGridRef, GhosttyPoint,
    GhosttyPointCoordinate, GhosttyPointTag_GHOSTTY_POINT_TAG_ACTIVE, GhosttyPointValue,
    GhosttyResult_GHOSTTY_SUCCESS, GhosttyStyle, GhosttyStyleColor,
    GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_PALETTE, GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_RGB,
    GhosttyTerminal, GhosttyTerminalImpl, GhosttyTerminalOptions,
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
    /// Cells fall back to a blank cell (space char, default colors, no attrs)
    /// when libghostty reports a non-success status for a given position; this
    /// matches an empty terminal cell.
    pub fn cells(&self) -> Cells {
        let total = (self.rows as usize) * (self.cols as usize);
        let mut data = Vec::with_capacity(total);

        for row in 0..self.rows {
            for col in 0..self.cols {
                data.push(self.cell_at(row, col));
            }
        }

        Cells {
            rows: self.rows,
            cols: self.cols,
            data,
        }
    }

    fn cell_at(&self, row: u16, col: u16) -> Cell {
        let point = GhosttyPoint {
            tag: GhosttyPointTag_GHOSTTY_POINT_TAG_ACTIVE,
            value: GhosttyPointValue {
                coordinate: GhosttyPointCoordinate {
                    x: col,
                    y: row as u32,
                },
            },
        };

        // `GhosttyGridRef` is a sized struct (grid_ref.h): the `size` field
        // must be set to `sizeof(GhosttyGridRef)` before the call so libghostty
        // knows which struct version the caller was compiled against.
        // SAFETY: `GhosttyGridRef` is POD (size_t + pointer + two u16s); a
        // zeroed pointer is a valid null pointer.
        let mut grid_ref: GhosttyGridRef = unsafe { mem::zeroed() };
        grid_ref.size = mem::size_of::<GhosttyGridRef>();

        // SAFETY: `self.handle` is live (Drop bound to `&self`); `point` is
        // fully initialized POD with the `coordinate` union variant set to
        // match the ACTIVE tag; `&mut grid_ref` is a valid writable pointer.
        let r = unsafe {
            ghostty_terminal_grid_ref(self.handle.as_ptr(), point, &mut grid_ref)
        };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return blank_cell();
        }

        let ch = grid_ref_codepoint(&grid_ref);
        let (fg, bg, attrs) = grid_ref_style(&grid_ref);
        Cell { ch, fg, bg, attrs }
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

fn grid_ref_codepoint(grid_ref: &GhosttyGridRef) -> char {
    let mut cell: GhosttyCell = 0;
    // SAFETY: `grid_ref` is a valid initialized GhosttyGridRef built by
    // libghostty above; `&mut cell` is a valid pointer to a u64.
    let r = unsafe { ghostty_grid_ref_cell(grid_ref, &mut cell) };
    if r != GhosttyResult_GHOSTTY_SUCCESS {
        return ' ';
    }

    let mut codepoint: u32 = 0;
    // SAFETY: `cell` is passed by value; the CODEPOINT data kind requires a
    // `uint32_t*` output, which matches `&mut codepoint`.
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

fn grid_ref_style(grid_ref: &GhosttyGridRef) -> (Color, Color, Attrs) {
    // `GhosttyStyle` is a sized struct (style.h): zero-init then set the
    // size field per the same compat contract as GhosttyGridRef.
    // SAFETY: `GhosttyStyle` is POD: size_t + 3 tagged unions over POD
    // unions + bools + an int. All-zero is a valid initial state.
    let mut style: GhosttyStyle = unsafe { mem::zeroed() };
    style.size = mem::size_of::<GhosttyStyle>();

    // SAFETY: `grid_ref` was filled by ghostty_terminal_grid_ref above;
    // `&mut style` is a valid writable pointer to a sized-init GhosttyStyle.
    let r = unsafe { ghostty_grid_ref_style(grid_ref, &mut style) };
    if r != GhosttyResult_GHOSTTY_SUCCESS {
        return (Color::Default, Color::Default, Attrs::empty());
    }

    let mut attrs = Attrs::empty();
    attrs.set(Attrs::BOLD, style.bold);
    attrs.set(Attrs::ITALIC, style.italic);
    attrs.set(Attrs::UNDERLINE, style.underline != 0);
    attrs.set(Attrs::REVERSE, style.inverse);
    attrs.set(Attrs::DIM, style.faint);
    attrs.set(Attrs::STRIKE, style.strikethrough);

    (
        style_color_to_color(style.fg_color),
        style_color_to_color(style.bg_color),
        attrs,
    )
}

fn style_color_to_color(c: GhosttyStyleColor) -> Color {
    #[allow(non_upper_case_globals)] // bindgen-generated constant names
    match c.tag {
        GhosttyStyleColorTag_GHOSTTY_STYLE_COLOR_PALETTE => {
            // SAFETY: tag PALETTE means the `palette` arm of the union is the
            // active variant per libghostty's tagged-union contract.
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

impl Drop for Terminal {
    fn drop(&mut self) {
        // SAFETY: `self.handle` was obtained from `ghostty_terminal_new`,
        // has not been freed before (Drop runs at most once), and is not
        // observed after this call (the Terminal is being destroyed).
        unsafe { ghostty_terminal_free(self.handle.as_ptr()) };
    }
}

