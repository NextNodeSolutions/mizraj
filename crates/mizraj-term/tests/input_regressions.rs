//! Regression coverage for the input path the apostrophe bug went through
//! (US-International layouts make `'` a dead key) and for the render-state
//! cursor defaults the frontend blink heuristic relies on.

use mizraj_term::{KeyEncoder, Mods, RenderState, Terminal};

/// The committed apostrophe encodes as itself regardless of which physical
/// key carried it (AZERTY Digit4, US Quote, or an IME commit with no code).
#[test]
fn apostrophe_keystroke_roundtrip() {
    let terminal = Terminal::new(24, 80).expect("terminal");
    let mut encoder = KeyEncoder::new().expect("encoder");

    for code in ["Digit4", "Quote", "Unidentified"] {
        let bytes = encoder
            .encode(&terminal, code, Some("'"), Mods::default())
            .expect("encode apostrophe");
        assert_eq!(bytes, b"'", "code {code} must encode the apostrophe text");
    }

    let mut term = Terminal::new(24, 80).expect("terminal");
    term.feed(b"don't").expect("feed");
    let mut rs = RenderState::new().expect("render state");
    rs.update(&mut term).expect("update");
    let cells = rs.snapshot().expect("snapshot");
    assert_eq!(cells.data[3].ch, "'", "the echo lands in the grid verbatim");
}

/// A dead-key press itself (text committed later by composition) must encode
/// to nothing — the frontend forwards the commit separately.
#[test]
fn dead_key_press_alone_encodes_nothing() {
    let terminal = Terminal::new(24, 80).expect("terminal");
    let mut encoder = KeyEncoder::new().expect("encoder");

    for code in ["Digit4", "Quote"] {
        let bytes = encoder
            .encode(&terminal, code, None, Mods::default())
            .expect("encode dead key");
        assert!(
            bytes.is_empty(),
            "code {code} without text must send nothing"
        );
    }
}

/// The wire collapses the never-styled cursor to block+steady — the contract
/// the frontend's default-blink heuristic (cursorBlinks) is built on. If
/// libghostty starts reporting the default as blinking, drop the heuristic.
#[test]
fn cursor_blink_wire_defaults() {
    let mut term = Terminal::new(24, 80).expect("terminal");
    let mut rs = RenderState::new().expect("render state");

    rs.update(&mut term).expect("update");
    let initial = rs.cursor().expect("cursor read").expect("cursor present");
    assert!(!initial.blink, "initial cursor reports steady on the wire");

    term.feed(b"\x1b[5 q").expect("feed DECSCUSR blinking bar");
    rs.update(&mut term).expect("update");
    let blinking = rs.cursor().expect("cursor read").expect("cursor present");
    assert!(blinking.blink, "DECSCUSR 5 reports blinking");

    term.feed(b"\x1b[6 q").expect("feed DECSCUSR steady bar");
    rs.update(&mut term).expect("update");
    let steady = rs.cursor().expect("cursor read").expect("cursor present");
    assert!(!steady.blink, "DECSCUSR 6 reports steady");
}
