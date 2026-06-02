use std::path::Path;

use git2::Repository;
use thiserror::Error;

pub use git2;

pub mod branch;
pub mod diff;
pub mod session_ref;
pub mod worktree;

pub use branch::{current_branch, Head};
pub use diff::{diff_head_base, diff_session, diff_working_tree};
pub use session_ref::create_session_ref;
pub use worktree::{worktree_list, WorktreeInfo};

pub type Result<T> = std::result::Result<T, VcsError>;

#[derive(Debug, Error)]
pub enum VcsError {
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
}

pub fn repo_open(path: &Path) -> Result<Repository> {
    Ok(Repository::open(path)?)
}

/// The URL of the `origin` remote, or `None` when the repo has no such remote.
///
/// Used to derive a stable per-project slug for the progress database path; a
/// missing `origin` is an expected case (callers fall back to the directory
/// name), so it surfaces as `Ok(None)` rather than an error.
pub fn origin_url(repo: &Repository) -> Result<Option<String>> {
    match repo.find_remote("origin") {
        Ok(remote) => Ok(remote.url().map(str::to_owned)),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_repo(path: &Path) {
        let mut opts = git2::RepositoryInitOptions::new();
        opts.external_template(false);
        Repository::init_opts(path, &opts).expect("init fixture repo");
    }

    #[test]
    fn opens_existing_repo() {
        let dir = tempfile::tempdir().expect("create tempdir");
        init_repo(dir.path());

        let repo = repo_open(dir.path()).expect("repo_open should succeed");
        assert!(repo.path().exists());
    }

    #[test]
    fn returns_vcs_error_on_non_repo() {
        let dir = tempfile::tempdir().expect("create tempdir");

        let err = repo_open(dir.path()).err().expect("repo_open should fail");
        let VcsError::Git(inner) = err;
        assert_eq!(inner.code(), git2::ErrorCode::NotFound);
    }

    #[test]
    fn origin_url_is_none_without_an_origin_remote() {
        let dir = tempfile::tempdir().expect("create tempdir");
        init_repo(dir.path());
        let repo = repo_open(dir.path()).expect("repo_open");

        assert_eq!(origin_url(&repo).expect("origin_url should succeed"), None);
    }

    #[test]
    fn origin_url_returns_the_configured_origin_remote() {
        let dir = tempfile::tempdir().expect("create tempdir");
        init_repo(dir.path());
        let repo = repo_open(dir.path()).expect("repo_open");
        repo.remote("origin", "git@github.com:NextNodeSolutions/mizraj.git")
            .expect("set origin remote");

        assert_eq!(
            origin_url(&repo).expect("origin_url should succeed"),
            Some("git@github.com:NextNodeSolutions/mizraj.git".to_string())
        );
    }
}
