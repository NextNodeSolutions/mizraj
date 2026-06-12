use serde::ser::{Serialize, SerializeMap, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("binary not found on PATH: {0}")]
    BinaryNotFound(String),

    #[error("failed to spawn pty: {0}")]
    Spawn(String),

    #[error("failed to probe login-shell PATH: {0}")]
    PathProbe(#[source] std::io::Error),

    #[error("session not found: {0}")]
    NotFound(String),

    #[error("session input channel closed")]
    InputClosed,

    #[error("failed to register session ref: {0}")]
    SessionRef(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("failed to resize pty: {0}")]
    Resize(String),

    #[error("no terminal frame available for session: {0}")]
    FrameUnavailable(String),
}

impl Serialize for SessionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(Some(2))?;
        match self {
            SessionError::BinaryNotFound(binary) => {
                map.serialize_entry("kind", "binary_not_found")?;
                map.serialize_entry("binary", binary)?;
            }
            SessionError::Spawn(message) => {
                map.serialize_entry("kind", "spawn")?;
                map.serialize_entry("message", message)?;
            }
            SessionError::PathProbe(err) => {
                map.serialize_entry("kind", "path_probe")?;
                map.serialize_entry("message", &err.to_string())?;
            }
            SessionError::NotFound(id) => {
                map.serialize_entry("kind", "not_found")?;
                map.serialize_entry("session_id", id)?;
            }
            SessionError::InputClosed => {
                map.serialize_entry("kind", "input_closed")?;
                map.serialize_entry("message", "session input channel closed")?;
            }
            SessionError::SessionRef(message) => {
                map.serialize_entry("kind", "session_ref")?;
                map.serialize_entry("message", message)?;
            }
            SessionError::Database(message) => {
                map.serialize_entry("kind", "database")?;
                map.serialize_entry("message", message)?;
            }
            SessionError::Resize(message) => {
                map.serialize_entry("kind", "resize")?;
                map.serialize_entry("message", message)?;
            }
            SessionError::FrameUnavailable(id) => {
                map.serialize_entry("kind", "frame_unavailable")?;
                map.serialize_entry("session_id", id)?;
            }
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_binary_not_found_with_kind_and_binary() {
        let err = SessionError::BinaryNotFound("claude".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"binary_not_found","binary":"claude"}"#);
    }

    #[test]
    fn serializes_spawn_with_kind_and_message() {
        let err = SessionError::Spawn("boom".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"spawn","message":"boom"}"#);
    }

    #[test]
    fn serializes_path_probe_with_kind_and_message() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "no zsh");
        let err = SessionError::PathProbe(io_err);
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"path_probe","message":"no zsh"}"#);
    }

    #[test]
    fn serializes_not_found_with_kind_and_session_id() {
        let err = SessionError::NotFound("01H8XYZ".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"not_found","session_id":"01H8XYZ"}"#);
    }

    #[test]
    fn serializes_session_ref_with_kind_and_message() {
        let err = SessionError::SessionRef("repo not found".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"session_ref","message":"repo not found"}"#);
    }

    #[test]
    fn serializes_database_with_kind_and_message() {
        let err = SessionError::Database("constraint failed".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, r#"{"kind":"database","message":"constraint failed"}"#);
    }

    #[test]
    fn serializes_frame_unavailable_with_kind_and_session_id() {
        let err = SessionError::FrameUnavailable("01H8XYZ".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(
            json,
            r#"{"kind":"frame_unavailable","session_id":"01H8XYZ"}"#
        );
    }

    #[test]
    fn serializes_input_closed_with_kind_and_message() {
        let err = SessionError::InputClosed;
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(
            json,
            r#"{"kind":"input_closed","message":"session input channel closed"}"#
        );
    }
}
