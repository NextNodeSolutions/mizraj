pub mod registry;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use mizraj_vcs::branch::{current_branch, Head};
use mizraj_vcs::repo_open;
use serde::Serialize;

use crate::db::{self, Db};

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
    active_project: tauri::State<'_, ActiveProject>,
    db: tauri::State<'_, Db>,
    registry: tauri::State<'_, registry::SharedRegistry>,
) -> Result<(), String> {
    let canonical = validate_repo_path(&repo_path)?;
    // Auto-register (MP4): becoming active is the only gesture that grows the
    // registry. A persist failure must not block the switch itself.
    if let Err(err) = registry.add(canonical.clone()) {
        tracing::warn!(error = %err, "auto-register active project failed");
    }
    // Resolve and open the project's own progress.db before flipping the active
    // project, so a failed open leaves the previous selection intact.
    let slug = db::repo_slug(&canonical);
    let db_path = db::progress_db_path(&slug);
    let pool = db::open(&db_path)
        .await
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;
    db.set(pool).await;
    active_project.set(canonical);
    Ok(())
}

#[tauri::command]
pub async fn clear_active_project(
    active_project: tauri::State<'_, ActiveProject>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    db.clear().await;
    active_project.clear();
    Ok(())
}

/// What the UI shows as "where am I": the checked-out branch, or a detached
/// HEAD marker.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct RepoHead {
    pub branch: Option<String>,
    pub detached: bool,
}

/// Return the active project's HEAD as a displayable payload.
#[tauri::command]
pub fn repo_head(active_project: tauri::State<'_, ActiveProject>) -> Result<RepoHead, String> {
    let repo_path = active_project
        .get()
        .ok_or_else(|| "no active project".to_string())?;
    repo_head_inner(&repo_path)
}

fn repo_head_inner(repo_path: &Path) -> Result<RepoHead, String> {
    let repo = repo_open(repo_path).map_err(|e| e.to_string())?;
    match current_branch(&repo).map_err(|e| e.to_string())? {
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

fn validate_repo_path(repo_path: &str) -> Result<PathBuf, String> {
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
