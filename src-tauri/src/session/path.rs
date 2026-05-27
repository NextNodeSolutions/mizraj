use std::path::PathBuf;

use crate::session::error::SessionError;

pub fn resolve(binary: &str) -> Result<PathBuf, SessionError> {
    which::which(binary).map_err(|_| SessionError::BinaryNotFound(binary.to_string()))
}

#[cfg(target_os = "macos")]
pub fn capture_login_shell_path() -> Option<String> {
    let output = match std::process::Command::new("/bin/zsh")
        .args(["-lc", "echo $PATH"])
        .output()
    {
        Ok(output) => output,
        Err(err) => {
            tracing::warn!(error = %err, "failed to spawn /bin/zsh for PATH probe");
            return None;
        }
    };

    if !output.status.success() {
        tracing::warn!(
            status = %output.status,
            stderr = %String::from_utf8_lossy(&output.stderr),
            "/bin/zsh PATH probe exited non-zero",
        );
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        tracing::warn!("/bin/zsh PATH probe returned empty output");
        return None;
    }

    Some(path)
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
