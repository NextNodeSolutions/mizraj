use std::path::PathBuf;

use crate::session::error::SessionError;

pub fn resolve(binary: &str) -> Result<PathBuf, SessionError> {
    which::which(binary).map_err(|_| SessionError::BinaryNotFound(binary.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_existing_binary() {
        let path = resolve("echo").expect("echo should be on PATH");
        assert!(path.is_absolute(), "expected absolute path, got {path:?}");
    }

    #[test]
    fn missing_binary_yields_binary_not_found() {
        let err = resolve("nope-not-real-xyz").expect_err("nonexistent binary should fail");
        match err {
            SessionError::BinaryNotFound(name) => assert_eq!(name, "nope-not-real-xyz"),
            other => panic!("expected BinaryNotFound, got {other:?}"),
        }
    }
}
