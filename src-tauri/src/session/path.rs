use std::path::PathBuf;

use crate::session::error::SessionError;

pub fn resolve(binary: &str) -> Result<PathBuf, SessionError> {
    which::which(binary).map_err(|_| SessionError::BinaryNotFound(binary.to_string()))
}

#[cfg(target_os = "macos")]
pub fn probe_login_shell() -> Result<String, std::io::Error> {
    use std::io::Error;

    let shell = std::env::var("SHELL")
        .map_err(|err| Error::other(format!("SHELL env var not set: {err}")))?;
    let output = std::process::Command::new(&shell)
        .args(["-lc", "echo $PATH"])
        .output()?;

    if !output.status.success() {
        return Err(Error::other(format!(
            "{shell} PATH probe exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Err(Error::other(format!(
            "{shell} PATH probe returned empty output"
        )));
    }

    Ok(path)
}

#[cfg(target_os = "macos")]
pub fn capture_login_shell_path() -> Option<String> {
    match probe_login_shell() {
        Ok(path) => Some(path),
        Err(err) => {
            tracing::warn!(error = %err, "login-shell PATH probe failed");
            None
        }
    }
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
