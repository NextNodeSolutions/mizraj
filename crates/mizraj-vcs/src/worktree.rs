use std::path::{Path, PathBuf};

use git2::{Repository, WorktreeLockStatus};

use crate::branch::{current_branch, Head};
use crate::Result;

/// The main checkout's working directory for the repository at `repo_path`.
///
/// For a normal checkout this is just the repo's own working directory. For a
/// linked git worktree it is the **main** repository's working directory, so a
/// worktree and its parent resolve to the same root — both share one
/// `progress.db`. Resolution: a linked worktree's gitdir is
/// `<main>/.git/worktrees/<name>/`, and its `commondir` file points at the
/// common `<main>/.git`; the main working directory is that common dir's parent.
///
/// Returns `None` when `repo_path` is not inside a git repository, or when the
/// repo is bare / its layout can't be resolved — callers fall back to the
/// canonicalized path.
pub fn main_workdir(repo_path: &Path) -> Option<PathBuf> {
    let repo = Repository::open(repo_path).ok()?;
    if repo.is_worktree() {
        // `repo.path()` is `<main>/.git/worktrees/<name>/`. The common git dir
        // is named by the sibling `commondir` file (a path relative to that
        // dir, or absolute); the main working dir is its parent.
        let gitdir = repo.path();
        let commondir = read_commondir(gitdir)?;
        let common_canonical = commondir.canonicalize().ok()?;
        return common_canonical.parent().map(Path::to_path_buf);
    }
    // A normal (non-worktree) checkout: its own working directory is the root.
    repo.workdir().map(Path::to_path_buf)
}

/// Resolve the common git dir of a linked worktree from its `commondir` file.
/// The file holds a path (usually relative, e.g. `../..`) to the main `.git`.
fn read_commondir(gitdir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(gitdir.join("commondir")).ok()?;
    let target = Path::new(raw.trim());
    if target.is_absolute() {
        Some(target.to_path_buf())
    } else {
        Some(gitdir.join(target))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: PathBuf,
    pub head: Head,
    pub locked: bool,
}

// TODO(V2): worktree UX is not wired into the cockpit yet. The fail-fast
// behaviour on a broken worktree (missing path, corrupted .git) is acceptable
// for V1 because nothing calls this. When the UI starts listing worktrees,
// switch to skip + tracing::warn so one zombie entry doesn't break the panel.
pub fn worktree_list(repo: &Repository) -> Result<Vec<WorktreeInfo>> {
    let names = repo.worktrees()?;
    let mut out = Vec::with_capacity(names.len());
    for entry in names.iter() {
        let Some(name) = entry else { continue };
        let wt = repo.find_worktree(name)?;
        let path = wt.path().to_path_buf();
        let locked = !matches!(wt.is_locked()?, WorktreeLockStatus::Unlocked);
        let wt_repo = Repository::open(&path)?;
        let head = current_branch(&wt_repo)?;
        out.push(WorktreeInfo {
            name: name.to_string(),
            path,
            head,
            locked,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, RepositoryInitOptions, Signature};
    use std::fs;
    use std::path::Path;

    fn init_repo(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        Repository::init_opts(path, &opts).expect("init fixture repo")
    }

    fn commit_file(repo: &Repository, name: &str, contents: &str, message: &str) -> Oid {
        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join(name), contents).expect("write file");

        let mut index = repo.index().expect("index");
        index.add_path(Path::new(name)).expect("add_path");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write_tree");
        let tree = repo.find_tree(tree_id).expect("find_tree");

        let sig = Signature::now("Test", "test@example.com").expect("signature");
        let parents: Vec<git2::Commit> = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .expect("commit")
    }

    #[test]
    fn returns_empty_when_no_linked_worktrees() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let worktrees = worktree_list(&repo).expect("worktree_list");
        assert!(worktrees.is_empty());
    }

    #[test]
    fn lists_added_worktree_with_metadata() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let wt_root = tempfile::tempdir().expect("create wt tempdir");
        let wt_path = wt_root.path().join("feature");
        repo.worktree("feature", &wt_path, None)
            .expect("create worktree");

        let worktrees = worktree_list(&repo).expect("worktree_list");
        assert_eq!(worktrees.len(), 1);

        let entry = &worktrees[0];
        assert_eq!(entry.name, "feature");
        assert_eq!(entry.head, Head::Branch("feature".to_string()));
        assert!(!entry.locked);
        assert_eq!(
            entry.path.canonicalize().expect("canonicalize entry path"),
            wt_path.canonicalize().expect("canonicalize wt path"),
        );
    }

    #[test]
    fn main_workdir_of_a_plain_checkout_is_its_own_workdir() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let resolved = main_workdir(dir.path()).expect("main_workdir");
        assert_eq!(
            resolved.canonicalize().expect("canonicalize resolved"),
            dir.path().canonicalize().expect("canonicalize dir"),
        );
    }

    #[test]
    fn main_workdir_of_a_linked_worktree_resolves_to_the_main_checkout() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let wt_root = tempfile::tempdir().expect("create wt tempdir");
        let wt_path = wt_root.path().join("feature");
        repo.worktree("feature", &wt_path, None)
            .expect("create worktree");

        // Opening from inside the linked worktree must still resolve to the
        // MAIN checkout, so a worktree session shares the main progress.db.
        let resolved = main_workdir(&wt_path).expect("main_workdir from worktree");
        assert_eq!(
            resolved.canonicalize().expect("canonicalize resolved"),
            dir.path().canonicalize().expect("canonicalize main dir"),
        );
    }

    #[test]
    fn main_workdir_is_none_outside_a_repository() {
        let dir = tempfile::tempdir().expect("create tempdir");
        assert_eq!(main_workdir(dir.path()), None);
    }

    #[test]
    fn marks_locked_worktree() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let wt_root = tempfile::tempdir().expect("create wt tempdir");
        let wt_path = wt_root.path().join("locked");
        let wt = repo
            .worktree("locked", &wt_path, None)
            .expect("create worktree");
        wt.lock(Some("under maintenance")).expect("lock worktree");

        let worktrees = worktree_list(&repo).expect("worktree_list");
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].name, "locked");
        assert!(worktrees[0].locked);
    }
}
