use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::id::SessionId;
use crate::session::sink::OutputSink;

pub const AGENT_OUTPUT_EVENT: &str = "agent:output";

pub const AGENT_END_EVENT: &str = "agent:end";

/// Wire shape of the `agent:output` Tauri event (D1, D13).
///
/// PTY merges stdout and stderr into a single stream, so `kind` is always
/// `"stdout"` for now. The field is kept to let a future structured-channel
/// runtime distinguish stderr without breaking the wire format.
#[derive(Debug, Clone, Serialize)]
pub struct AgentOutputPayload<'a> {
    pub session_id: &'a str,
    pub kind: &'a str,
    pub text: &'a str,
}

/// Wire shape of the `agent:end` Tauri event (D8).
///
/// Emitted once when the child process terminates, so the frontend can flip
/// the session to `ended` and auto-open the diff at the end of a run.
#[derive(Debug, Clone, Serialize)]
pub struct SessionEndPayload<'a> {
    pub session_id: &'a str,
    pub exit_code: u32,
}

/// `OutputSink` that forwards each PTY chunk to the frontend as an
/// `agent:output` Tauri event.
///
/// One emit per chunk, not per line: real PTY chunks routinely carry partial
/// lines or interleaved ANSI escape sequences, and the `<AgentLog>` ANSI
/// parser (SAS-330) consumes the raw stream. Splitting at `\n` would force a
/// stateful per-line buffer here and force the parser to reconstruct one
/// later — so we hand the frontend the bytes verbatim.
///
/// `partial` holds the trailing bytes of the last write that formed an
/// incomplete UTF-8 sequence. PTY reads routinely slice multi-byte chars in
/// half (emoji = 4 bytes, accented latin = 2 bytes, CJK = 3 bytes); flushing
/// only the valid-UTF-8 prefix and carrying the suffix to the next write
/// keeps every codepoint intact across chunk boundaries.
pub struct TauriEventSink<R: Runtime> {
    app: AppHandle<R>,
    session_id: SessionId,
    partial: Mutex<Vec<u8>>,
}

impl<R: Runtime> TauriEventSink<R> {
    pub fn new(app: AppHandle<R>, session_id: SessionId) -> Self {
        Self {
            app,
            session_id,
            partial: Mutex::new(Vec::new()),
        }
    }
}

/// Drain `buf` into an emittable `String`, honouring UTF-8 codepoint
/// boundaries:
/// - Valid prefix → pushed verbatim
/// - Invalid sequence (`error_len = Some(n)`) → replaced with U+FFFD, the
///   n bad bytes are consumed
/// - Incomplete trailing sequence (`error_len = None`) → left in `buf` for
///   the next call so the multi-byte char isn't split mid-flight
fn drain_valid_utf8(buf: &mut Vec<u8>) -> String {
    let mut emit = String::with_capacity(buf.len());
    let mut consumed = 0usize;
    loop {
        let remaining = &buf[consumed..];
        if remaining.is_empty() {
            break;
        }
        match std::str::from_utf8(remaining) {
            Ok(s) => {
                emit.push_str(s);
                consumed += remaining.len();
                break;
            }
            Err(err) => {
                let prefix = std::str::from_utf8(&remaining[..err.valid_up_to()])
                    .expect("valid by construction");
                emit.push_str(prefix);
                consumed += err.valid_up_to();
                match err.error_len() {
                    Some(n) => {
                        emit.push('\u{fffd}');
                        consumed += n;
                    }
                    None => break,
                }
            }
        }
    }
    buf.drain(..consumed);
    emit
}

impl<R: Runtime> OutputSink for TauriEventSink<R> {
    fn write(&self, bytes: &[u8]) {
        let mut partial = self
            .partial
            .lock()
            .expect("TauriEventSink partial mutex poisoned");
        partial.extend_from_slice(bytes);
        let text = drain_valid_utf8(&mut partial);
        drop(partial);

        if text.is_empty() {
            return;
        }

        let _ = self.app.emit(
            AGENT_OUTPUT_EVENT,
            AgentOutputPayload {
                session_id: self.session_id.as_str(),
                kind: "stdout",
                text: text.as_str(),
            },
        );
    }

    fn end(&self, exit_code: u32) {
        let _ = self.app.emit(
            AGENT_END_EVENT,
            SessionEndPayload {
                session_id: self.session_id.as_str(),
                exit_code,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_output_event_name_is_stable() {
        assert_eq!(AGENT_OUTPUT_EVENT, "agent:output");
    }

    #[test]
    fn payload_serializes_with_session_id_kind_and_text() {
        let id = SessionId::new();
        let payload = AgentOutputPayload {
            session_id: id.as_str(),
            kind: "stdout",
            text: "hello world",
        };
        let json = serde_json::to_value(&payload).expect("serialize payload");
        assert_eq!(json["session_id"], id.as_str());
        assert_eq!(json["kind"], "stdout");
        assert_eq!(json["text"], "hello world");
    }

    #[test]
    fn agent_end_event_name_is_stable() {
        assert_eq!(AGENT_END_EVENT, "agent:end");
    }

    #[test]
    fn session_end_payload_serializes_with_session_id_and_exit_code() {
        let id = SessionId::new();
        let payload = SessionEndPayload {
            session_id: id.as_str(),
            exit_code: 0,
        };
        let json = serde_json::to_value(&payload).expect("serialize payload");
        assert_eq!(json["session_id"], id.as_str());
        assert_eq!(json["exit_code"], 0);
    }

    #[test]
    fn drain_valid_utf8_holds_back_partial_multibyte_prefix() {
        let mut buf = vec![0xF0, 0x9F]; // first 2 bytes of U+1F600 😀
        let text = drain_valid_utf8(&mut buf);
        assert_eq!(text, "");
        assert_eq!(buf, vec![0xF0, 0x9F]);
    }

    #[test]
    fn drain_valid_utf8_reassembles_emoji_across_two_writes() {
        let mut buf = vec![0xF0, 0x9F];
        let first = drain_valid_utf8(&mut buf);
        assert_eq!(first, "");

        buf.extend_from_slice(&[0x98, 0x80]);
        let second = drain_valid_utf8(&mut buf);
        assert_eq!(second, "😀");
        assert!(buf.is_empty());
    }

    #[test]
    fn drain_valid_utf8_replaces_invalid_sequence_with_u_fffd() {
        // 0xC3 0x28 — 0xC3 starts a 2-byte sequence but 0x28 is not a valid
        // continuation byte, so the sequence is invalid (not incomplete).
        let mut buf = vec![b'a', 0xC3, 0x28, b'b'];
        let text = drain_valid_utf8(&mut buf);
        assert_eq!(text, "a\u{fffd}(b");
        assert!(buf.is_empty());
    }

    #[test]
    fn drain_valid_utf8_pass_through_for_ascii() {
        let mut buf = b"hello".to_vec();
        let text = drain_valid_utf8(&mut buf);
        assert_eq!(text, "hello");
        assert!(buf.is_empty());
    }

    #[test]
    fn payload_preserves_ansi_escape_bytes() {
        let bytes = b"\x1b[31mred\x1b[0m";
        let text = String::from_utf8_lossy(bytes);
        let payload = AgentOutputPayload {
            session_id: "01HZ",
            kind: "stdout",
            text: text.as_ref(),
        };
        let json = serde_json::to_string(&payload).expect("serialize payload");
        assert!(
            json.contains("\\u001b[31mred\\u001b[0m"),
            "ansi escapes must survive serde_json escaping, got: {json}"
        );
    }
}
