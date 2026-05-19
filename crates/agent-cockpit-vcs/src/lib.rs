use std::path::Path;

use git2::Repository;
use thiserror::Error;

pub use git2;

pub type Result<T> = std::result::Result<T, VcsError>;

#[derive(Debug, Error)]
pub enum VcsError {
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
}

pub fn repo_open(path: &Path) -> Result<Repository> {
    Ok(Repository::open(path)?)
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
}
