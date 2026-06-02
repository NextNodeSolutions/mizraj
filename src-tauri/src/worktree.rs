use std::path::PathBuf;
use std::process::Command;

use thiserror::Error;

use crate::session::SessionId;

#[derive(Debug, Error)]
pub enum WtError {
    #[error("failed to spawn zsh for `wt new`: {0}")]
    Spawn(#[source] std::io::Error),

    #[error("`wt new` exited with {status}: {stderr}")]
    NonZeroExit { status: String, stderr: String },

    #[error("could not extract worktree path from `wt new` stdout")]
    PathNotFound,
}

/// Shell out to `wt new <session_id>` via the user's login zsh and return the
/// resolved worktree path.
///
/// Uses `zsh -c 'source ~/.zshrc && wt new <id> -y'` so the autoloaded `wt`
/// function is available and never blocks on an interactive prompt.
pub fn spawn_worktree(session_id: &SessionId) -> Result<PathBuf, WtError> {
    let script = format!("source ~/.zshrc && wt new {} -y", session_id);
    let output = Command::new("zsh")
        .args(["-c", &script])
        .output()
        .map_err(WtError::Spawn)?;

    if !output.status.success() {
        return Err(WtError::NonZeroExit {
            status: output.status.to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_worktree_path(&stdout).ok_or(WtError::PathNotFound)
}

const PATH_MARKERS: &[&str] = &[
    "📍 You are now in: ",
    "✅ Worktree already exists, switched to: ",
    "✅ Switched to worktree: ",
    "📂 Path: ",
];

fn extract_worktree_path(stdout: &str) -> Option<PathBuf> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        for marker in PATH_MARKERS {
            if let Some(rest) = trimmed.strip_prefix(marker) {
                let path = rest.trim();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_from_you_are_now_in_marker() {
        let stdout = "📦 Project: mizraj\n\
                      🌿 Branch: 01HXYZ\n\
                      📂 Path: /Users/me/development/worktrees/mizraj-01HXYZ\n\
                      ✅ Branch exists, creating worktree...\n\
                      📍 You are now in: /Users/me/development/worktrees/mizraj-01HXYZ\n";
        let path = extract_worktree_path(stdout).expect("path should be extracted");
        assert_eq!(
            path,
            PathBuf::from("/Users/me/development/worktrees/mizraj-01HXYZ")
        );
    }

    #[test]
    fn extracts_path_from_already_exists_marker() {
        let stdout = "✅ Worktree already exists, switched to: /tmp/wt/abc\n";
        let path = extract_worktree_path(stdout).expect("path should be extracted");
        assert_eq!(path, PathBuf::from("/tmp/wt/abc"));
    }

    #[test]
    fn extracts_path_from_path_marker_only() {
        let stdout = "📂 Path: /tmp/wt/xyz\nother noise\n";
        let path = extract_worktree_path(stdout).expect("path should be extracted");
        assert_eq!(path, PathBuf::from("/tmp/wt/xyz"));
    }

    #[test]
    fn returns_none_when_no_marker_is_present() {
        let stdout = "no path here\njust noise\n";
        assert!(extract_worktree_path(stdout).is_none());
    }

    #[test]
    fn ignores_marker_lines_with_empty_path() {
        let stdout = "📂 Path: \n";
        assert!(extract_worktree_path(stdout).is_none());
    }
}
