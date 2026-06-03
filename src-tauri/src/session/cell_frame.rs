use mizraj_term::{Cell, CellWidth, Cells, Color};
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
    pub ch: char,
    pub fg: WireColor,
    pub bg: WireColor,
    pub attrs: u8,
    pub wide: WireCellWidth,
}

impl From<&Cell> for WireCell {
    fn from(cell: &Cell) -> Self {
        Self {
            ch: cell.ch,
            fg: cell.fg.into(),
            bg: cell.bg.into(),
            attrs: cell.attrs.bits(),
            wide: cell.width.into(),
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
}

impl CellFrame {
    pub fn from_cells(session_id: String, cells: &Cells) -> Self {
        Self {
            session_id,
            cols: cells.cols,
            rows: cells.rows,
            cells: cells.data.iter().map(WireCell::from).collect(),
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
                    ch: 'H',
                    fg: Color::Indexed(1),
                    bg: Color::Default,
                    attrs: Attrs::BOLD,
                    width: CellWidth::Narrow,
                },
                Cell {
                    ch: 'i',
                    fg: Color::Rgb(10, 20, 30),
                    bg: Color::Default,
                    attrs: Attrs::ITALIC | Attrs::UNDERLINE,
                    width: CellWidth::Narrow,
                },
                Cell {
                    ch: ' ',
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::Narrow,
                },
            ],
        };

        let frame = CellFrame::from_cells("sess-1".to_string(), &cells);

        assert_eq!(frame.session_id, "sess-1");
        assert_eq!(frame.rows, 1);
        assert_eq!(frame.cols, 3);
        assert_eq!(frame.cells.len(), 3);

        assert_eq!(frame.cells[0].ch, 'H');
        assert_eq!(frame.cells[0].fg, WireColor::Indexed { idx: 1 });
        assert_eq!(frame.cells[0].bg, WireColor::Default);
        assert_eq!(frame.cells[0].attrs, Attrs::BOLD.bits());

        assert_eq!(frame.cells[1].ch, 'i');
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

        assert_eq!(frame.cells[2].ch, ' ');
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
                ch: 'X',
                fg: Color::Rgb(1, 2, 3),
                bg: Color::Indexed(4),
                attrs: Attrs::BOLD,
                width: CellWidth::Narrow,
            }],
        };

        let frame = CellFrame::from_cells("s".to_string(), &cells);
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
    }

    #[test]
    fn wide_serializes_to_snake_case_variants() {
        let cells = Cells {
            rows: 1,
            cols: 2,
            data: vec![
                Cell {
                    ch: '中',
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::Wide,
                },
                Cell {
                    ch: ' ',
                    fg: Color::Default,
                    bg: Color::Default,
                    attrs: Attrs::empty(),
                    width: CellWidth::SpacerTail,
                },
            ],
        };

        let json = serde_json::to_value(CellFrame::from_cells("s".to_string(), &cells))
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

        let frame = CellFrame::from_cells("sess".to_string(), &cells);

        assert_eq!(frame.rows, 4);
        assert_eq!(frame.cols, 10);
        assert_eq!(frame.cells.len(), 40);
        assert_eq!(frame.cells[0].ch, 'H');
        assert_eq!(frame.cells[1].ch, 'i');
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

        let frame = CellFrame::from_cells("sess".to_string(), &cells);

        assert_eq!(frame.cells[0].ch, '中');
        assert_eq!(frame.cells[0].wide, WireCellWidth::Wide);
        assert_eq!(frame.cells[1].wide, WireCellWidth::SpacerTail);
    }
}
