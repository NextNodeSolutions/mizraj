use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::id::SessionId;
use crate::session::sink::OutputSink;

pub const AGENT_OUTPUT_EVENT: &str = "agent:output";

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

/// `OutputSink` that forwards each PTY chunk to the frontend as an
/// `agent:output` Tauri event.
///
/// One emit per chunk, not per line: real PTY chunks routinely carry partial
/// lines or interleaved ANSI escape sequences, and the `<AgentLog>` ANSI
/// parser (SAS-330) consumes the raw stream. Splitting at `\n` would force a
/// stateful per-line buffer here and force the parser to reconstruct one
/// later — so we hand the frontend the bytes verbatim.
pub struct TauriEventSink<R: Runtime> {
    app: AppHandle<R>,
    session_id: SessionId,
}

impl<R: Runtime> TauriEventSink<R> {
    pub fn new(app: AppHandle<R>, session_id: SessionId) -> Self {
        Self { app, session_id }
    }
}

impl<R: Runtime> OutputSink for TauriEventSink<R> {
    fn write(&self, bytes: &[u8]) {
        let text = String::from_utf8_lossy(bytes);
        let _ = self.app.emit(
            AGENT_OUTPUT_EVENT,
            AgentOutputPayload {
                session_id: self.session_id.as_str(),
                kind: "stdout",
                text: text.as_ref(),
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
