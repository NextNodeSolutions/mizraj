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
}

impl From<which::Error> for SessionError {
    fn from(err: which::Error) -> Self {
        SessionError::BinaryNotFound(err.to_string())
    }
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
}
