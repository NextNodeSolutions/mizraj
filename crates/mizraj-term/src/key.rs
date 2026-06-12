use std::os::raw::c_char;
use std::ptr::{self, NonNull};

use mizraj_term_sys::{
    self as sys, ghostty_key_encoder_encode, ghostty_key_encoder_free, ghostty_key_encoder_new,
    ghostty_key_encoder_setopt_from_terminal, ghostty_key_event_free, ghostty_key_event_new,
    ghostty_key_event_set_action, ghostty_key_event_set_key, ghostty_key_event_set_mods,
    ghostty_key_event_set_utf8, GhosttyKey, GhosttyKeyAction_GHOSTTY_KEY_ACTION_PRESS,
    GhosttyKeyEncoderImpl, GhosttyKeyEventImpl, GhosttyMods, GhosttyResult_GHOSTTY_OUT_OF_SPACE,
    GhosttyResult_GHOSTTY_SUCCESS, GHOSTTY_MODS_ALT, GHOSTTY_MODS_CTRL, GHOSTTY_MODS_SHIFT,
};

use crate::{Result, TermError, Terminal};

/// Most VT key sequences are a handful of bytes; this stack buffer covers them
/// without a heap allocation. Longer sequences (kitty protocol edge cases) fall
/// back to a heap retry on `GHOSTTY_OUT_OF_SPACE`.
const ENCODE_STACK_BUF: usize = 128;

/// Keyboard modifiers active for a key press, in the small subset a webview
/// `KeyboardEvent` reports (Super/Cmd is intentionally excluded — it belongs to
/// the app, never the PTY).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Mods {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl Mods {
    pub(crate) fn to_ghostty(self) -> GhosttyMods {
        // The GHOSTTY_MODS_* masks are u32 consts; the setter wants a u16 bitmask.
        let mut bits: GhosttyMods = 0;
        if self.shift {
            bits |= GHOSTTY_MODS_SHIFT as GhosttyMods;
        }
        if self.ctrl {
            bits |= GHOSTTY_MODS_CTRL as GhosttyMods;
        }
        if self.alt {
            bits |= GHOSTTY_MODS_ALT as GhosttyMods;
        }
        bits
    }
}

/// Stateful libghostty key encoder. Allocate once per terminal and reuse it for
/// every keystroke; `encode` re-syncs the encoder from the terminal's live
/// modes (cursor-key application mode, kitty flags, backarrow, …) before each
/// call, so the output matches what the running child actually expects.
///
/// See `vendor/include/ghostty/vt/key/encoder.h` for the C API contract.
#[derive(Debug)]
pub struct KeyEncoder {
    handle: NonNull<GhosttyKeyEncoderImpl>,
}

impl KeyEncoder {
    pub fn new() -> Result<Self> {
        let mut raw = ptr::null_mut();
        // SAFETY: allocator may be NULL (defaults to the platform allocator per
        // the header); `&mut raw` is a valid stack pointer to receive the
        // out-handle.
        let r = unsafe { ghostty_key_encoder_new(ptr::null(), &mut raw) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Init(format!(
                "ghostty_key_encoder_new returned {r}"
            )));
        }
        let handle = NonNull::new(raw)
            .ok_or_else(|| TermError::Init("ghostty_key_encoder_new returned NULL".into()))?;
        Ok(Self { handle })
    }

    /// Encode a key press into the VT byte sequence the child expects, or an
    /// empty `Vec` when the key produces no output (lone modifiers, unmapped
    /// keys). `code` is a W3C `KeyboardEvent.code`; `text` is the layout text
    /// (`KeyboardEvent.key`) for printable keys, used only when it is a single
    /// non-control scalar — the encoder derives Ctrl/Alt sequences from the
    /// logical key + `mods`, not from this text.
    pub fn encode(
        &mut self,
        terminal: &Terminal,
        code: &str,
        text: Option<&str>,
        mods: Mods,
    ) -> Result<Vec<u8>> {
        // SAFETY: both handles are live (encoder Drop bound to `&mut self`,
        // terminal Drop bound to `&terminal`). This reads modes off the terminal
        // and applies them to the encoder; it must run before every encode
        // because the child can flip these modes between keystrokes.
        unsafe {
            ghostty_key_encoder_setopt_from_terminal(self.handle.as_ptr(), terminal.raw_handle());
        }

        let event = KeyEvent::new()?;
        event.set_press(w3c_code_to_ghostty(code), mods.to_ghostty());
        // `text` must outlive the encode call (libghostty does not copy it);
        // it stays borrowed for the whole function, so passing it here is sound.
        if let Some(t) = text.filter(|t| is_single_printable(t)) {
            event.set_text(t);
        }

        self.encode_event(&event)
    }

    fn encode_event(&self, event: &KeyEvent) -> Result<Vec<u8>> {
        let mut buf = [0u8; ENCODE_STACK_BUF];
        let (r, written) = self.encode_into(event, &mut buf);
        if r == GhosttyResult_GHOSTTY_SUCCESS {
            return Ok(buf[..written].to_vec());
        }
        if r != GhosttyResult_GHOSTTY_OUT_OF_SPACE {
            return Err(TermError::Encode(format!(
                "ghostty_key_encoder_encode returned {r}"
            )));
        }
        // `written` now holds the required size; retry once on a heap buffer
        // sized exactly to what libghostty asked for.
        let mut big = vec![0u8; written];
        let (r, written) = self.encode_into(event, &mut big);
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Encode(format!(
                "ghostty_key_encoder_encode (heap retry) returned {r}"
            )));
        }
        big.truncate(written);
        Ok(big)
    }

    /// One FFI encode into `buf`. Returns the libghostty result code and the
    /// count it reports: bytes written on `GHOSTTY_SUCCESS`, or the required
    /// buffer size on `GHOSTTY_OUT_OF_SPACE`.
    fn encode_into(&self, event: &KeyEvent, buf: &mut [u8]) -> (sys::GhosttyResult, usize) {
        let mut written: usize = 0;
        // SAFETY: encoder + event handles are live (encoder Drop is bound to
        // `&mut self` at the call site, event Drop to `&event`); `buf` and
        // `written` are valid for the whole call.
        let r = unsafe {
            ghostty_key_encoder_encode(
                self.handle.as_ptr(),
                event.handle.as_ptr(),
                buf.as_mut_ptr().cast::<c_char>(),
                buf.len(),
                &mut written,
            )
        };
        (r, written)
    }
}

impl Drop for KeyEncoder {
    fn drop(&mut self) {
        // SAFETY: handle obtained from `ghostty_key_encoder_new`, not freed
        // before (Drop runs at most once), not observed after.
        unsafe { ghostty_key_encoder_free(self.handle.as_ptr()) };
    }
}

/// RAII wrapper for a single `GhosttyKeyEvent`. Built fresh per keystroke so no
/// field (utf8 pointer, codepoint, composing flag) leaks from a prior press.
struct KeyEvent {
    handle: NonNull<GhosttyKeyEventImpl>,
}

impl KeyEvent {
    fn new() -> Result<Self> {
        let mut raw = ptr::null_mut();
        // SAFETY: allocator NULL = default; `&mut raw` receives the out-handle.
        let r = unsafe { ghostty_key_event_new(ptr::null(), &mut raw) };
        if r != GhosttyResult_GHOSTTY_SUCCESS {
            return Err(TermError::Encode(format!(
                "ghostty_key_event_new returned {r}"
            )));
        }
        let handle = NonNull::new(raw)
            .ok_or_else(|| TermError::Encode("ghostty_key_event_new returned NULL".into()))?;
        Ok(Self { handle })
    }

    fn set_press(&self, key: GhosttyKey, mods: GhosttyMods) {
        // SAFETY: handle is live (bound to `&self`); the setters take POD values.
        unsafe {
            ghostty_key_event_set_action(
                self.handle.as_ptr(),
                GhosttyKeyAction_GHOSTTY_KEY_ACTION_PRESS,
            );
            ghostty_key_event_set_key(self.handle.as_ptr(), key);
            ghostty_key_event_set_mods(self.handle.as_ptr(), mods);
        }
    }

    fn set_text(&self, text: &str) {
        // SAFETY: handle is live; `text` is valid UTF-8 of `len` bytes and (per
        // the caller) outlives the subsequent encode. libghostty does not take
        // ownership of the pointer.
        unsafe {
            ghostty_key_event_set_utf8(
                self.handle.as_ptr(),
                text.as_ptr().cast::<c_char>(),
                text.len(),
            );
        }
    }
}

impl Drop for KeyEvent {
    fn drop(&mut self) {
        // SAFETY: handle obtained from `ghostty_key_event_new`, freed once.
        unsafe { ghostty_key_event_free(self.handle.as_ptr()) };
    }
}

/// Pass layout text to the encoder only for a single printable scalar. The
/// header forbids C0 controls (U+0000–U+001F, U+007F) and macOS PUA function
/// codes (U+F700–U+F8FF) here — those must be driven by the logical key instead.
fn is_single_printable(text: &str) -> bool {
    let mut chars = text.chars();
    let Some(c) = chars.next() else {
        return false;
    };
    if chars.next().is_some() {
        return false;
    }
    !c.is_control() && !('\u{F700}'..='\u{F8FF}').contains(&c)
}

/// Map a W3C `KeyboardEvent.code` to a libghostty physical key. `GhosttyKey` is
/// defined directly against the W3C UI Events code standard, so this is a 1:1
/// translation; anything we do not name falls back to `UNIDENTIFIED`, leaving
/// the encoder to use the layout text (set via `set_text`) or emit nothing.
///
/// Letters (`KeyA`..`KeyZ`), digits (`Digit0`..`Digit9`) and function keys
/// (`F1`..`F24`) are contiguous in the enum (verified against `event.h`), so
/// they map by offset instead of one arm each.
fn w3c_code_to_ghostty(code: &str) -> GhosttyKey {
    if let Some(letter) = code.strip_prefix("Key") {
        let bytes = letter.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_uppercase() {
            return sys::GhosttyKey_GHOSTTY_KEY_A + (bytes[0] - b'A') as GhosttyKey;
        }
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        let bytes = digit.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_digit() {
            return sys::GhosttyKey_GHOSTTY_KEY_DIGIT_0 + (bytes[0] - b'0') as GhosttyKey;
        }
    }
    if let Some(num) = code.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&num) {
            return sys::GhosttyKey_GHOSTTY_KEY_F1 + (num - 1) as GhosttyKey;
        }
    }
    match code {
        "Enter" => sys::GhosttyKey_GHOSTTY_KEY_ENTER,
        "Tab" => sys::GhosttyKey_GHOSTTY_KEY_TAB,
        "Backspace" => sys::GhosttyKey_GHOSTTY_KEY_BACKSPACE,
        "Escape" => sys::GhosttyKey_GHOSTTY_KEY_ESCAPE,
        "Space" => sys::GhosttyKey_GHOSTTY_KEY_SPACE,
        "ArrowUp" => sys::GhosttyKey_GHOSTTY_KEY_ARROW_UP,
        "ArrowDown" => sys::GhosttyKey_GHOSTTY_KEY_ARROW_DOWN,
        "ArrowLeft" => sys::GhosttyKey_GHOSTTY_KEY_ARROW_LEFT,
        "ArrowRight" => sys::GhosttyKey_GHOSTTY_KEY_ARROW_RIGHT,
        "Home" => sys::GhosttyKey_GHOSTTY_KEY_HOME,
        "End" => sys::GhosttyKey_GHOSTTY_KEY_END,
        "PageUp" => sys::GhosttyKey_GHOSTTY_KEY_PAGE_UP,
        "PageDown" => sys::GhosttyKey_GHOSTTY_KEY_PAGE_DOWN,
        "Insert" => sys::GhosttyKey_GHOSTTY_KEY_INSERT,
        "Delete" => sys::GhosttyKey_GHOSTTY_KEY_DELETE,
        "Minus" => sys::GhosttyKey_GHOSTTY_KEY_MINUS,
        "Equal" => sys::GhosttyKey_GHOSTTY_KEY_EQUAL,
        "BracketLeft" => sys::GhosttyKey_GHOSTTY_KEY_BRACKET_LEFT,
        "BracketRight" => sys::GhosttyKey_GHOSTTY_KEY_BRACKET_RIGHT,
        "Backslash" => sys::GhosttyKey_GHOSTTY_KEY_BACKSLASH,
        "Semicolon" => sys::GhosttyKey_GHOSTTY_KEY_SEMICOLON,
        "Quote" => sys::GhosttyKey_GHOSTTY_KEY_QUOTE,
        "Backquote" => sys::GhosttyKey_GHOSTTY_KEY_BACKQUOTE,
        "Comma" => sys::GhosttyKey_GHOSTTY_KEY_COMMA,
        "Period" => sys::GhosttyKey_GHOSTTY_KEY_PERIOD,
        "Slash" => sys::GhosttyKey_GHOSTTY_KEY_SLASH,
        _ => sys::GhosttyKey_GHOSTTY_KEY_UNIDENTIFIED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESC: u8 = 0x1b;

    fn encode(code: &str, text: Option<&str>, mods: Mods) -> Vec<u8> {
        let terminal = Terminal::new(24, 80).expect("new terminal");
        let mut encoder = KeyEncoder::new().expect("new encoder");
        encoder.encode(&terminal, code, text, mods).expect("encode")
    }

    #[test]
    fn encodes_printable_letter_as_utf8() {
        assert_eq!(encode("KeyA", Some("a"), Mods::default()), b"a");
    }

    #[test]
    fn encodes_accented_char_as_utf8() {
        // 'é' (U+00E9) is two UTF-8 bytes; it has no physical key code, so the
        // layout text carries it.
        assert_eq!(
            encode("Unidentified", Some("é"), Mods::default()),
            vec![0xc3, 0xa9]
        );
    }

    #[test]
    fn encodes_enter_as_carriage_return() {
        assert_eq!(encode("Enter", None, Mods::default()), vec![b'\r']);
    }

    #[test]
    fn encodes_ctrl_c_as_etx() {
        let mods = Mods {
            ctrl: true,
            ..Mods::default()
        };
        assert_eq!(encode("KeyC", Some("c"), mods), vec![0x03]);
    }

    #[test]
    fn arrow_up_uses_normal_cursor_sequence_by_default() {
        assert_eq!(
            encode("ArrowUp", None, Mods::default()),
            vec![ESC, b'[', b'A']
        );
    }

    #[test]
    fn arrow_up_uses_application_sequence_when_terminal_sets_decckm() {
        // DECCKM on (ESC [ ? 1 h) flips cursor keys to application mode; the
        // encoder must read that off the terminal and emit ESC O A, not ESC [ A.
        // This is the exact case the hand-rolled frontend encoder got wrong.
        let mut terminal = Terminal::new(24, 80).expect("new terminal");
        terminal.feed(b"\x1b[?1h").expect("feed DECCKM");
        let mut encoder = KeyEncoder::new().expect("new encoder");

        let bytes = encoder
            .encode(&terminal, "ArrowUp", None, Mods::default())
            .expect("encode");

        assert_eq!(bytes, vec![ESC, b'O', b'A']);
    }

    #[test]
    fn unmapped_key_without_text_produces_no_bytes() {
        assert_eq!(
            encode("AudioVolumeUp", None, Mods::default()),
            Vec::<u8>::new()
        );
    }
}
