pub mod registry;
pub mod watcher;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use mizraj_vcs::branch::{current_branch, Head};
use mizraj_vcs::repo_open;
use serde::Serialize;

/// The active project's repository path, shared as Tauri managed state and read
/// by every command that operates on "the current project".
#[derive(Default)]
pub struct ActiveProject(Mutex<Option<PathBuf>>);

impl ActiveProject {
    pub fn set(&self, path: PathBuf) {
        let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = Some(path);
    }

    pub fn clear(&self) {
        let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = None;
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

#[tauri::command]
pub async fn set_active_project(
    repo_path: String,
    app: tauri::AppHandle,
    active_project: tauri::State<'_, ActiveProject>,
    registry: tauri::State<'_, registry::SharedRegistry>,
    watchers: tauri::State<'_, watcher::RepoWatchers>,
) -> Result<(), String> {
    // canonicalize() hits the filesystem; run it off the async worker.
    let canonical = tauri::async_runtime::spawn_blocking(move || validate_repo_path(&repo_path))
        .await
        .map_err(|err| format!("validate_repo_path task failed: {err}"))??;
    // Auto-register (MP4): becoming active is the only gesture that grows the
    // registry. A persist failure must not block the switch itself.
    match registry.add(canonical.clone()) {
        Ok(true) => watcher::watch_and_emit(&watchers, &app, &canonical),
        Ok(false) => {}
        Err(err) => {
            tracing::warn!(error = %err, "auto-register active project failed");
        }
    }
    // No pool is opened here: progress databases are per-repo and open lazily
    // on first read (Db::pool_for) — the active project is a UI preference.
    active_project.set(canonical);
    Ok(())
}

#[tauri::command]
pub fn clear_active_project(active_project: tauri::State<'_, ActiveProject>) {
    active_project.clear();
}

/// What the UI shows as "where am I": the checked-out branch, or a detached
/// HEAD marker.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct RepoHead {
    pub branch: Option<String>,
    pub detached: bool,
}

/// Return `repo_path`'s HEAD as a displayable payload. The repo is explicit
/// (MP1): overview surfaces read any registered repo without switching.
#[tauri::command]
pub fn repo_head(repo_path: String) -> Result<RepoHead, String> {
    let canonical = validate_repo_path(&repo_path)?;
    repo_head_inner(&canonical)
}

fn repo_head_inner(repo_path: &Path) -> Result<RepoHead, String> {
    let repo =
        repo_open(repo_path).map_err(|e| format!("open repo {}: {e}", repo_path.display()))?;
    match current_branch(&repo).map_err(|e| format!("read HEAD of {}: {e}", repo_path.display()))? {
        Head::Branch(name) => Ok(RepoHead {
            branch: Some(name),
            detached: false,
        }),
        Head::Detached => Ok(RepoHead {
            branch: None,
            detached: true,
        }),
    }
}

/// Normalize a caller-supplied repo path into a canonical, on-disk directory:
/// trim it, reject blank, `canonicalize`, and require a directory. Commands call
/// this at the top and operate on the returned [`PathBuf`] rather than the raw
/// string, so one place owns "is this a real repo path". Membership in the
/// registry is deliberately NOT required (MP1): any real on-disk repo stays
/// readable.
pub(crate) fn validate_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return Err("repo_path must not be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("canonicalize {}: {e}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_unset() {
        let active = ActiveProject::default();
        assert!(active.get().is_none());
    }

    #[test]
    fn returns_last_set_path() {
        let active = ActiveProject::default();
        active.set(PathBuf::from("/tmp/first"));
        active.set(PathBuf::from("/tmp/second"));
        assert_eq!(active.get(), Some(PathBuf::from("/tmp/second")));
    }

    #[test]
    fn clear_resets_to_none() {
        let active = ActiveProject::default();
        active.set(PathBuf::from("/tmp/here"));
        active.clear();
        assert!(active.get().is_none());
    }

    #[test]
    fn rejects_empty_repo_path() {
        let err = validate_repo_path("").unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
    }

    #[test]
    fn rejects_whitespace_only_repo_path() {
        let err = validate_repo_path("   \t").unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
    }

    #[test]
    fn rejects_non_existent_repo_path() {
        let err = validate_repo_path("/does/not/exist/anywhere").unwrap_err();
        assert!(err.starts_with("canonicalize "), "got: {err}");
    }

    #[test]
    fn rejects_file_instead_of_directory() {
        let tmp = tempfile::NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_string_lossy().to_string();
        let err = validate_repo_path(&path).unwrap_err();
        assert!(err.ends_with("is not a directory"), "got: {err}");
    }

    #[test]
    fn accepts_existing_directory_and_canonicalizes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().to_string_lossy().to_string();
        let canonical = validate_repo_path(&path).expect("validate");
        assert!(canonical.is_dir());
    }

    #[test]
    fn repo_head_reports_the_checked_out_branch() {
        use mizraj_vcs::git2::{Repository, RepositoryInitOptions};

        let dir = tempfile::tempdir().expect("tempdir");
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("feat/ui");
        Repository::init_opts(dir.path(), &opts).expect("init repo");

        let head = repo_head_inner(dir.path()).expect("repo_head");

        assert_eq!(
            head,
            RepoHead {
                branch: Some("feat/ui".to_string()),
                detached: false,
            }
        );
    }

    #[test]
    fn repo_head_fails_outside_a_repository() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err = repo_head_inner(dir.path()).expect_err("non-repo should fail");
        assert!(!err.is_empty());
    }
}
