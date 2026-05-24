use bitflags::bitflags;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Color {
    #[default]
    Default,
    Indexed(u8),
    Rgb(u8, u8, u8),
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct Attrs: u8 {
        const BOLD      = 1 << 0;
        const ITALIC    = 1 << 1;
        const UNDERLINE = 1 << 2;
        const REVERSE   = 1 << 3;
        const DIM       = 1 << 4;
        const STRIKE    = 1 << 5;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    pub ch: char,
    pub fg: Color,
    pub bg: Color,
    pub attrs: Attrs,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cells {
    pub rows: u16,
    pub cols: u16,
    pub data: Vec<Cell>,
}

impl Cells {
    pub fn get(&self, row: u16, col: u16) -> Option<&Cell> {
        if row >= self.rows || col >= self.cols {
            return None;
        }
        let idx = (row as usize) * (self.cols as usize) + (col as usize);
        self.data.get(idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(ch: char) -> Cell {
        Cell {
            ch,
            fg: Color::Default,
            bg: Color::Default,
            attrs: Attrs::empty(),
        }
    }

    #[test]
    fn get_returns_cell_when_in_bounds() {
        let cells = Cells {
            rows: 2,
            cols: 3,
            data: vec![
                cell('a'), cell('b'), cell('c'),
                cell('d'), cell('e'), cell('f'),
            ],
        };

        assert_eq!(cells.get(0, 0), Some(&cell('a')));
        assert_eq!(cells.get(0, 2), Some(&cell('c')));
        assert_eq!(cells.get(1, 0), Some(&cell('d')));
        assert_eq!(cells.get(1, 2), Some(&cell('f')));
    }

    #[test]
    fn get_returns_none_when_out_of_bounds() {
        let cells = Cells {
            rows: 2,
            cols: 3,
            data: vec![cell(' '); 6],
        };

        assert_eq!(cells.get(2, 0), None);
        assert_eq!(cells.get(0, 3), None);
        assert_eq!(cells.get(5, 5), None);
    }

    #[test]
    fn attrs_combine_via_bitflags() {
        let a = Attrs::BOLD | Attrs::UNDERLINE;
        assert!(a.contains(Attrs::BOLD));
        assert!(a.contains(Attrs::UNDERLINE));
        assert!(!a.contains(Attrs::ITALIC));
    }

    #[test]
    fn color_variants_compare() {
        assert_eq!(Color::default(), Color::Default);
        assert_ne!(Color::Indexed(1), Color::Indexed(2));
        assert_eq!(Color::Rgb(10, 20, 30), Color::Rgb(10, 20, 30));
    }
}
