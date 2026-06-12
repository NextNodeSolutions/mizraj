use std::ffi::OsString;
use std::path::PathBuf;

use crate::session::error::SessionError;

pub fn resolve(binary: &str) -> Result<PathBuf, SessionError> {
    which::which(binary).map_err(|_| SessionError::BinaryNotFound(binary.to_string()))
}

/// The platform's safe shell when `$SHELL` is unusable: zsh has been the macOS
/// default since Catalina; POSIX sh everywhere else.
#[cfg(target_os = "macos")]
const FALLBACK_SHELL: &str = "/bin/zsh";
#[cfg(not(target_os = "macos"))]
const FALLBACK_SHELL: &str = "/bin/sh";

/// The user's preferred shell — what a plain (non-agent) terminal spawns.
pub fn default_shell() -> String {
    default_shell_from(std::env::var_os("SHELL"))
}

fn default_shell_from(shell: Option<OsString>) -> String {
    shell
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| FALLBACK_SHELL.to_string())
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
    fn default_shell_prefers_the_env_var() {
        assert_eq!(
            default_shell_from(Some(OsString::from("/opt/fish"))),
            "/opt/fish"
        );
    }

    #[test]
    fn default_shell_falls_back_when_env_is_absent_or_empty() {
        assert_eq!(default_shell_from(None), FALLBACK_SHELL);
        assert_eq!(default_shell_from(Some(OsString::new())), FALLBACK_SHELL);
    }

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
