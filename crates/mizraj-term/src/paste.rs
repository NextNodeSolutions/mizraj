//! Paste encoding via libghostty (`ghostty_paste_encode`).
//!
//! Pasting is not a plain PTY write: unsafe control bytes must be stripped
//! (ESC injection), newlines become carriage returns outside bracketed-paste
//! mode, and the payload is wrapped in `ESC[200~ … ESC[201~` when the child
//! switched DEC mode 2004 on. libghostty owns those rules; this is the safe
//! wrapper.

use mizraj_term_sys::{
    ghostty_paste_encode, GhosttyResult_GHOSTTY_OUT_OF_SPACE, GhosttyResult_GHOSTTY_SUCCESS,
};

use crate::{Result, TermError};

/// `ESC[200~` + `ESC[201~`: the fixed growth bracketed wrapping can add.
const BRACKET_OVERHEAD: usize = 12;

/// Encode pasted text for the PTY exactly like Ghostty would: strip unsafe
/// control bytes, then wrap in bracketed-paste markers (`bracketed` = DEC
/// mode 2004 is on) or convert newlines to carriage returns (mode off).
pub fn encode_paste(data: &[u8], bracketed: bool) -> Result<Vec<u8>> {
    // The FFI strips unsafe bytes from the input in place: hand it a copy so
    // the caller's buffer stays pristine. Stripping is idempotent, so the
    // grow-and-retry loop below can safely re-encode the same copy.
    let mut input = data.to_vec();
    let mut buf = vec![0u8; data.len() + BRACKET_OVERHEAD];

    loop {
        let mut written: usize = 0;
        // SAFETY: `input` and `buf` are live, correctly sized Vec buffers for
        // the duration of the call; `written` is a local out-param. The FFI
        // writes at most `buf.len()` bytes and reports the rest via
        // OUT_OF_SPACE + `written`.
        let result = unsafe {
            ghostty_paste_encode(
                input.as_mut_ptr().cast(),
                input.len(),
                bracketed,
                buf.as_mut_ptr().cast(),
                buf.len(),
                &mut written,
            )
        };
        if result == GhosttyResult_GHOSTTY_SUCCESS {
            buf.truncate(written);
            return Ok(buf);
        }
        if result == GhosttyResult_GHOSTTY_OUT_OF_SPACE {
            buf = vec![0u8; written];
            continue;
        }
        return Err(TermError::Paste(format!(
            "ghostty_paste_encode returned {result}"
        )));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bracketed_paste_wraps_with_markers() {
        let encoded = encode_paste(b"hello", true).expect("encode");
        assert_eq!(encoded, b"\x1b[200~hello\x1b[201~");
    }

    #[test]
    fn bracketed_paste_keeps_newlines_inside_the_markers() {
        let encoded = encode_paste(b"a\nb", true).expect("encode");
        assert_eq!(encoded, b"\x1b[200~a\nb\x1b[201~");
    }

    #[test]
    fn plain_paste_converts_newlines_to_carriage_returns() {
        let encoded = encode_paste(b"a\nb", false).expect("encode");
        assert_eq!(encoded, b"a\rb");
    }

    #[test]
    fn unsafe_escape_bytes_are_stripped() {
        let encoded = encode_paste(b"a\x1bb", false).expect("encode");
        assert!(
            !encoded.contains(&0x1b),
            "ESC must not survive a plain paste, got {encoded:?}"
        );
    }

    #[test]
    fn empty_paste_encodes_to_just_the_markers_when_bracketed() {
        assert_eq!(encode_paste(b"", true).expect("encode"), b"\x1b[200~\x1b[201~");
        assert_eq!(encode_paste(b"", false).expect("encode"), b"");
    }
}
