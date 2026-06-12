use mizraj_term::{Cell, CellWidth, Cells, Color, Cursor, CursorShape};
use serde::Serialize;

/// Wire representation of a single cell color (D4).
///
/// Mirrors the three forms libghostty tracks: the terminal default (resolved to
/// the frontend's theme), an ANSI palette index, or a 24-bit truecolor triple.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireColor {
    Default,
    Indexed { idx: u8 },
    Rgb { r: u8, g: u8, b: u8 },
}

impl From<Color> for WireColor {
    fn from(color: Color) -> Self {
        match color {
            Color::Default => WireColor::Default,
            Color::Indexed(idx) => WireColor::Indexed { idx },
            Color::Rgb(r, g, b) => WireColor::Rgb { r, g, b },
        }
    }
}

/// Wire representation of a cell's width (DG5).
///
/// Mirrors libghostty's `GhosttyCellWide`: a wide character (CJK, many emoji)
/// occupies two columns — `Wide` carries the glyph, `SpacerTail` is the
/// placeholder the frontend must not draw a glyph into; `SpacerHead` pads a
/// soft-wrapped line before a wide char that did not fit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WireCellWidth {
    Narrow,
    Wide,
    SpacerTail,
    SpacerHead,
}

impl From<CellWidth> for WireCellWidth {
    fn from(width: CellWidth) -> Self {
        match width {
            CellWidth::Narrow => WireCellWidth::Narrow,
            CellWidth::Wide => WireCellWidth::Wide,
            CellWidth::SpacerTail => WireCellWidth::SpacerTail,
            CellWidth::SpacerHead => WireCellWidth::SpacerHead,
        }
    }
}

/// Wire representation of one terminal cell (D4).
///
/// `attrs` carries the raw bits of [`mizraj_term::Attrs`] verbatim so the
/// frontend mirrors a single bit layout instead of decoding six booleans per
/// cell: `BOLD = 1 << 0`, `ITALIC = 1 << 1`, `UNDERLINE = 1 << 2`,
/// `REVERSE = 1 << 3`, `DIM = 1 << 4`, `STRIKE = 1 << 5`. `wide` lets the
/// frontend span wide glyphs across two columns and skip spacer cells.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WireCell {
    pub ch: String,
    pub fg: WireColor,
    pub bg: WireColor,
    pub attrs: u8,
    pub wide: WireCellWidth,
}

impl From<Cell> for WireCell {
    fn from(cell: Cell) -> Self {
        Self {
            ch: cell.ch,
            fg: cell.fg.into(),
            bg: cell.bg.into(),
            attrs: cell.attrs.bits(),
            wide: cell.width.into(),
        }
    }
}

/// Wire representation of the cursor shape (DG6), using the same vocabulary as
/// the config's `cursor-style` directive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WireCursorStyle {
    Block,
    Bar,
    Underline,
    BlockHollow,
}

impl From<CursorShape> for WireCursorStyle {
    fn from(shape: CursorShape) -> Self {
        match shape {
            CursorShape::Block => WireCursorStyle::Block,
            CursorShape::Bar => WireCursorStyle::Bar,
            CursorShape::Underline => WireCursorStyle::Underline,
            CursorShape::BlockHollow => WireCursorStyle::BlockHollow,
        }
    }
}

/// Wire representation of the cursor (DG6): its viewport position, shape, and the
/// terminal's blink / visible modes. The frontend draws it; absent (`None`) when
/// the cursor is scrolled out of the viewport.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WireCursor {
    pub x: u16,
    pub y: u16,
    pub style: WireCursorStyle,
    pub blink: bool,
    pub visible: bool,
}

impl From<Cursor> for WireCursor {
    fn from(cursor: Cursor) -> Self {
        Self {
            x: cursor.x,
            y: cursor.y,
            style: cursor.shape.into(),
            blink: cursor.blink,
            visible: cursor.visible,
        }
    }
}

/// A full grid snapshot emitted to the frontend once per render frame (D4).
///
/// `cells` is row-major (`row * cols + col`), matching [`Cells`]. `session_id`
/// rides in the payload so a single global `agent:cells` event can fan out to
/// every open session, the same shape the `agent:output` event already uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CellFrame {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<WireCell>,
    pub cursor: Option<WireCursor>,
    /// Whether the child enabled a mouse-tracking mode (DEC 1000/1002/1003):
    /// the frontend then forwards mouse events for PTY encoding instead of
    /// selecting locally (shift still forces selection, like Ghostty).
    pub mouse_reporting: bool,
    /// Rows the viewport sits ABOVE the live area (0 = attached to live).
    pub viewport_top: u64,
    /// Rows of scrollback history available above the live area.
    pub history_total: u64,
}

/// Frame-level terminal state that rides alongside the grid (TP6/TP10/TP11).
#[derive(Debug, Clone, Copy, Default)]
pub struct FrameContext {
    pub mouse_reporting: bool,
    pub viewport_top: u64,
    pub history_total: u64,
}

impl CellFrame {
    /// Consumes `cells`, moving each glyph cluster into the wire frame rather than
    /// cloning the whole grid's strings (the snapshot is discarded right after).
    pub fn from_cells(
        session_id: String,
        cells: Cells,
        cursor: Option<Cursor>,
        context: FrameContext,
    ) -> Self {
        Self {
            session_id,
            cols: cells.cols,
            rows: cells.rows,
            cells: cells.data.into_iter().map(WireCell::from).collect(),
            cursor: cursor.map(WireCursor::from),
            mouse_reporting: context.mouse_reporting,
            viewport_top: context.viewport_top,
            history_total: context.history_total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mizraj_term::Attrs;

    #[test]
    fn from_cells_preserves_dimensions_glyphs_colors_and_attrs() {
        let cells = Cells {
            rows: 1,
            cols: 3,
            data: vec![
                Cell {
                    ch: "H".to_string(),
                    fg: Color::Indexed(1),
                    bg: Color::Default,
                    attrs: Attrs::BOLD,
                    width: CellWidth::Narrow,
                },
                Cell {
                    ch: "i".to_string(),
                    fg: Color::Rgb(10, 20, 30),
                    bg: Color::Default,
                    attrs: Attrs::ITALIC | Attrs::UNDERLINE,
                    width: CellWidth::Narrow,
                },
                Cell {
                    ch: " ".to_string(),
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::Narrow,
                },
            ],
        };

        let frame = CellFrame::from_cells("sess-1".to_string(), cells, None, FrameContext::default());

        assert_eq!(frame.session_id, "sess-1");
        assert_eq!(frame.rows, 1);
        assert_eq!(frame.cols, 3);
        assert_eq!(frame.cells.len(), 3);

        assert_eq!(frame.cells[0].ch, "H");
        assert_eq!(frame.cells[0].fg, WireColor::Indexed { idx: 1 });
        assert_eq!(frame.cells[0].bg, WireColor::Default);
        assert_eq!(frame.cells[0].attrs, Attrs::BOLD.bits());

        assert_eq!(frame.cells[1].ch, "i");
        assert_eq!(
            frame.cells[1].fg,
            WireColor::Rgb {
                r: 10,
                g: 20,
                b: 30
            }
        );
        assert_eq!(
            frame.cells[1].attrs,
            (Attrs::ITALIC | Attrs::UNDERLINE).bits()
        );

        assert_eq!(frame.cells[2].ch, " ");
        assert_eq!(frame.cells[2].fg, WireColor::Default);
        assert_eq!(frame.cells[2].attrs, 0);

        // Plain ASCII cells are all narrow.
        assert!(frame.cells.iter().all(|c| c.wide == WireCellWidth::Narrow));
    }

    #[test]
    fn serializes_to_stable_wire_shape() {
        let cells = Cells {
            rows: 1,
            cols: 1,
            data: vec![Cell {
                ch: "X".to_string(),
                fg: Color::Rgb(1, 2, 3),
                bg: Color::Indexed(4),
                attrs: Attrs::BOLD,
                width: CellWidth::Narrow,
            }],
        };

        let frame = CellFrame::from_cells("s".to_string(), cells, None, FrameContext::default());
        let json = serde_json::to_value(&frame).expect("serialize CellFrame");

        assert_eq!(json["session_id"], "s");
        assert_eq!(json["cols"], 1);
        assert_eq!(json["rows"], 1);
        assert_eq!(json["cells"][0]["ch"], "X");
        assert_eq!(json["cells"][0]["fg"]["kind"], "rgb");
        assert_eq!(json["cells"][0]["fg"]["r"], 1);
        assert_eq!(json["cells"][0]["fg"]["g"], 2);
        assert_eq!(json["cells"][0]["fg"]["b"], 3);
        assert_eq!(json["cells"][0]["bg"]["kind"], "indexed");
        assert_eq!(json["cells"][0]["bg"]["idx"], 4);
        assert_eq!(json["cells"][0]["attrs"], Attrs::BOLD.bits());
        assert_eq!(json["cells"][0]["wide"], "narrow");
        assert_eq!(json["cursor"], serde_json::Value::Null);
    }

    #[test]
    fn serializes_cursor_state() {
        let cells = Cells {
            rows: 1,
            cols: 1,
            data: vec![Cell {
                ch: " ".to_string(),
                fg: Color::Default,
                bg: Color::Default,
                attrs: Attrs::empty(),
                width: CellWidth::Narrow,
            }],
        };
        let cursor = Some(Cursor {
            x: 3,
            y: 2,
            shape: CursorShape::Bar,
            blink: true,
            visible: true,
        });

        let json = serde_json::to_value(CellFrame::from_cells("s".to_string(), cells, cursor, FrameContext::default()))
            .expect("serialize CellFrame");

        assert_eq!(json["cursor"]["x"], 3);
        assert_eq!(json["cursor"]["y"], 2);
        assert_eq!(json["cursor"]["style"], "bar");
        assert_eq!(json["cursor"]["blink"], true);
        assert_eq!(json["cursor"]["visible"], true);
    }

    #[test]
    fn wide_serializes_to_snake_case_variants() {
        let cells = Cells {
            rows: 1,
            cols: 2,
            data: vec![
                Cell {
                    ch: "中".to_string(),
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::Wide,
                },
                Cell {
                    ch: " ".to_string(),
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::SpacerTail,
                },
            ],
        };

        let json = serde_json::to_value(CellFrame::from_cells("s".to_string(), cells, None, FrameContext::default()))
            .expect("serialize CellFrame");

        assert_eq!(json["cells"][0]["wide"], "wide");
        assert_eq!(json["cells"][1]["wide"], "spacer_tail");
    }

    /// End-to-end: a raw VT byte sequence fed through a real libghostty
    /// `Terminal` snapshots into the `CellFrame` we expect.
    #[test]
    fn byte_sequence_through_terminal_produces_expected_frame() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(4, 10).expect("terminal");
        term.feed(b"Hi").expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cells = render_state.snapshot().expect("snapshot");

        let frame = CellFrame::from_cells("sess".to_string(), cells, None, FrameContext::default());

        assert_eq!(frame.rows, 4);
        assert_eq!(frame.cols, 10);
        assert_eq!(frame.cells.len(), 40);
        assert_eq!(frame.cells[0].ch, "H");
        assert_eq!(frame.cells[1].ch, "i");
    }

    /// A real CJK glyph fed through libghostty lands as a `Wide` cell followed by
    /// a `SpacerTail`, proving the wide flag is read end-to-end from the FFI.
    #[test]
    fn wide_character_through_terminal_marks_wide_then_spacer_tail() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(2, 10).expect("terminal");
        term.feed("中".as_bytes()).expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cells = render_state.snapshot().expect("snapshot");

        let frame = CellFrame::from_cells("sess".to_string(), cells, None, FrameContext::default());

        assert_eq!(frame.cells[0].ch, "中");
        assert_eq!(frame.cells[0].wide, WireCellWidth::Wide);
        assert_eq!(frame.cells[1].wide, WireCellWidth::SpacerTail);
    }

    /// A base codepoint plus a combining mark fed through libghostty lands as one
    /// cell carrying the FULL grapheme cluster, not just the base codepoint.
    #[test]
    fn combining_mark_is_kept_as_a_full_grapheme_cluster() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(2, 10).expect("terminal");
        // 'e' followed by U+0301 COMBINING ACUTE ACCENT ("é" in decomposed form).
        term.feed("e\u{0301}".as_bytes()).expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cells = render_state.snapshot().expect("snapshot");

        let frame = CellFrame::from_cells("sess".to_string(), cells, None, FrameContext::default());

        assert_eq!(frame.cells[0].ch, "e\u{0301}");
    }

    /// The render state reports the cursor's viewport position end-to-end: after
    /// printing two glyphs the cursor sits at column 2, row 0, and is visible.
    #[test]
    fn cursor_reports_viewport_position_after_input() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(4, 10).expect("terminal");
        term.feed(b"Hi").expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cells = render_state.snapshot().expect("snapshot");
        let cursor = render_state.cursor().expect("cursor");

        let frame = CellFrame::from_cells("sess".to_string(), cells, cursor, FrameContext::default());
        let drawn = frame.cursor.expect("cursor present in viewport");

        assert_eq!(drawn.x, 2);
        assert_eq!(drawn.y, 0);
        assert!(drawn.visible);
    }

    /// DECTCEM reset (ESC[?25l) hides the cursor: the render state must report it
    /// not-visible so the renderer does not draw a stray cursor over a TUI that
    /// manages its own.
    #[test]
    fn cursor_hidden_by_dectcem_reports_not_visible() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(4, 10).expect("terminal");
        term.feed(b"\x1b[?25l").expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cursor = render_state.cursor().expect("cursor");

        assert_eq!(cursor.map(|c| c.visible), Some(false));
    }

    /// Absolute cursor positioning (CUP) is reported in viewport cell coords so
    /// the renderer draws the cursor where the program put it.
    #[test]
    fn cursor_follows_absolute_positioning() {
        use mizraj_term::{RenderState, Terminal};

        let mut term = Terminal::new(10, 20).expect("terminal");
        // CUP to row 6, col 4 (1-indexed) -> viewport (x=3, y=5) zero-indexed.
        term.feed(b"\x1b[6;4H").expect("feed");

        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        let cursor = render_state
            .cursor()
            .expect("cursor")
            .expect("cursor in viewport");

        assert_eq!((cursor.x, cursor.y), (3, 5));
    }

    /// A cursor-only move (no cell content change) must still mark the render
    /// state dirty, otherwise term_sink skips the frame and the drawn cursor goes
    /// stale as the program repositions it.
    #[test]
    fn cursor_only_move_marks_dirty() {
        use mizraj_term::{Dirty, RenderState, Terminal};

        let mut term = Terminal::new(4, 10).expect("terminal");
        term.feed(b"hi").expect("feed");
        let mut render_state = RenderState::new().expect("render state");
        render_state.update(&mut term).expect("update");
        render_state.mark_clean().expect("mark clean");

        // Move the cursor only — no cell content changes.
        term.feed(b"\x1b[3;5H").expect("feed");
        let dirty = render_state.update(&mut term).expect("update");

        assert_ne!(dirty, Dirty::Clean);
    }
}
