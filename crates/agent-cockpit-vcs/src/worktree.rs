use std::path::PathBuf;

use git2::{Repository, WorktreeLockStatus};

use crate::Result;
use crate::branch::current_branch;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: PathBuf,
    pub branch: String,
    pub locked: bool,
}

pub fn worktree_list(repo: &Repository) -> Result<Vec<WorktreeInfo>> {
    let names = repo.worktrees()?;
    let mut out = Vec::with_capacity(names.len());
    for entry in names.iter() {
        let Some(name) = entry else { continue };
        let wt = repo.find_worktree(name)?;
        let path = wt.path().to_path_buf();
        let locked = !matches!(wt.is_locked()?, WorktreeLockStatus::Unlocked);
        let wt_repo = Repository::open(&path)?;
        let branch = current_branch(&wt_repo)?;
        out.push(WorktreeInfo {
            name: name.to_string(),
            path,
            branch,
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
        assert_eq!(entry.branch, "feature");
        assert!(!entry.locked);
        assert_eq!(
            entry.path.canonicalize().expect("canonicalize entry path"),
            wt_path.canonicalize().expect("canonicalize wt path"),
        );
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
