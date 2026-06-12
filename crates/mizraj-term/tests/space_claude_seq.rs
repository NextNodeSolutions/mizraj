use mizraj_term::{Dirty, RenderState, Terminal};

fn dirty_after(bytes: &[u8]) -> (Dirty, u16) {
    let mut term = Terminal::new(30, 100).unwrap();
    term.feed(b"hello").unwrap();
    let mut rs = RenderState::new().unwrap();
    rs.update(&mut term).unwrap();
    rs.mark_clean().unwrap();
    term.feed(bytes).unwrap();
    let dirty = rs.update(&mut term).unwrap();
    let x = rs.cursor().unwrap().map(|c| c.x).unwrap_or(999);
    (dirty, x)
}

/// libghostty does not flag relative cursor moves as dirty; RenderState must
/// compensate, otherwise an Ink-style TUI advancing past a typed space with a
/// bare `CSI 1C` (exactly what Claude Code emits) never repaints the cursor.
#[test]
fn relative_cursor_move_reports_dirty() {
    // The exact synchronized-update burst Claude Code emits after a lone space.
    let claude = b"\x1b[?2026h\x1b[?25l\x1b[1C\x1b[?25h\x1b[?2026l";
    assert_eq!(dirty_after(claude), (Dirty::Partial, 6));
    assert_eq!(dirty_after(b"\x1b[1C"), (Dirty::Partial, 6));
    assert_eq!(dirty_after(b"\x1b[3;5H"), (Dirty::Partial, 4));
}

/// A truly idle update (no bytes at all) must stay Clean so frame pacing keeps
/// skipping no-op frames.
#[test]
fn no_change_stays_clean() {
    let mut term = Terminal::new(30, 100).unwrap();
    term.feed(b"hello").unwrap();
    let mut rs = RenderState::new().unwrap();
    rs.update(&mut term).unwrap();
    rs.mark_clean().unwrap();
    assert_eq!(rs.update(&mut term).unwrap(), Dirty::Clean);
}
