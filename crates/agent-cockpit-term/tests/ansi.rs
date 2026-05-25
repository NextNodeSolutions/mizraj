//! End-to-end check that libghostty actually parses ANSI sequences.
//!
//! Requires libghostty linked at test time: `LIBGHOSTTY_LIB_DIR` must
//! point to a directory containing `libghostty.dylib` (macOS) or
//! `libghostty.so` (Linux). Without it the test binary fails to link.

use std::path::PathBuf;

use agent_cockpit_term::{Color, Terminal};

const FIXTURE_RED_FOO: &str = "tests/fixtures/ansi/red-foo.bin";
const ANSI_PALETTE_RED: u8 = 1; // ESC[31m → palette index 1

#[test]
fn red_foo_fixture_decodes_to_red_glyphs() {
    let fixture_bytes = std::fs::read(fixture_path(FIXTURE_RED_FOO))
        .expect("read red-foo.bin fixture");

    let mut term = Terminal::new(4, 16).expect("Terminal::new(4, 16) should succeed");
    term.feed(&fixture_bytes).expect("feed should succeed");

    let cells = term.cells();
    assert_eq!(cells.rows, 4);
    assert_eq!(cells.cols, 16);

    let row0: Vec<char> = (0..3)
        .map(|col| cells.get(0, col).expect("cell in bounds").ch)
        .collect();
    assert_eq!(
        row0,
        vec!['f', 'o', 'o'],
        "expected ANSI parser to decode the three glyphs at row 0 cols 0..3"
    );

    for col in 0..3 {
        let cell = cells.get(0, col).expect("cell in bounds");
        assert_eq!(
            cell.fg,
            Color::Indexed(ANSI_PALETTE_RED),
            "expected fg = palette index {ANSI_PALETTE_RED} (red) for glyph at col {col}, got {:?}",
            cell.fg,
        );
        assert_eq!(cell.bg, Color::Default, "bg should remain default");
        assert!(
            cell.attrs.is_empty(),
            "no SGR attrs should be set, got {:?}",
            cell.attrs,
        );
    }

    let after_reset = cells.get(0, 3).expect("col 3 in bounds");
    assert_eq!(
        after_reset.fg,
        Color::Default,
        "fg should reset to default after ESC[0m"
    );
    assert!(after_reset.attrs.is_empty());
}

fn fixture_path(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel)
}
