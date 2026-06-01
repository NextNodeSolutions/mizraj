use git2::{Diff, DiffOptions, Repository};

use crate::Result;

const SESSION_REF_PREFIX: &str = "refs/mizraj/sessions/";

pub fn diff_session<'repo>(repo: &'repo Repository, session_id: &str) -> Result<Diff<'repo>> {
    let session_ref_name = format!("{SESSION_REF_PREFIX}{session_id}");
    let session_ref = repo.find_reference(&session_ref_name)?;
    let session_tree = session_ref.peel_to_commit()?.tree()?;

    let head_tree = repo.head()?.peel_to_commit()?.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&session_tree), Some(&head_tree), None)?;
    Ok(diff)
}

/// Diff every uncommitted change against `HEAD`: staged, unstaged, and
/// untracked. We diff the HEAD tree to the working directory *through the
/// index* (`diff_tree_to_workdir_with_index`) rather than index-to-workdir so
/// that staged changes (`git add`) stay visible — an agent that stages its
/// edits must still show them. On an unborn branch (no commits yet) there is no
/// HEAD tree, so we pass `None` and the whole working tree reads as additions.
pub fn diff_working_tree(repo: &Repository) -> Result<Diff<'_>> {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let head_tree = match repo.head() {
        Ok(head) => Some(head.peel_to_tree()?),
        Err(err) if err.code() == git2::ErrorCode::UnbornBranch => None,
        Err(err) => return Err(err.into()),
    };

    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?;
    Ok(diff)
}

pub fn diff_head_base<'repo>(repo: &'repo Repository, base: &str) -> Result<Diff<'repo>> {
    let base_tree = repo.revparse_single(base)?.peel_to_commit()?.tree()?;
    let head_tree = repo.head()?.peel_to_commit()?.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None)?;
    Ok(diff)
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
    fn returns_diff_between_session_ref_and_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());

        let session_oid = commit_file(&repo, "a.txt", "v1\n", "session base");
        repo.reference(
            "refs/mizraj/sessions/test-session",
            session_oid,
            false,
            "create session ref",
        )
        .expect("create session ref");

        commit_file(&repo, "a.txt", "v2\n", "advance head");

        let diff = diff_session(&repo, "test-session").expect("diff_session");
        assert_eq!(diff.deltas().count(), 1);

        let mut hunk_count = 0usize;
        diff.foreach(
            &mut |_, _| true,
            None,
            Some(&mut |_, _| {
                hunk_count += 1;
                true
            }),
            None,
        )
        .expect("foreach diff");
        assert_eq!(hunk_count, 1);
    }

    #[test]
    fn returns_empty_diff_when_session_ref_matches_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());

        let oid = commit_file(&repo, "a.txt", "v1\n", "only commit");
        repo.reference(
            "refs/mizraj/sessions/same",
            oid,
            false,
            "create session ref",
        )
        .expect("create session ref");

        let diff = diff_session(&repo, "same").expect("diff_session");
        assert_eq!(diff.deltas().count(), 0);
    }

    #[test]
    fn errors_when_session_ref_missing() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let err = diff_session(&repo, "missing").err().expect("should fail");
        let crate::VcsError::Git(inner) = err;
        assert_eq!(inner.code(), git2::ErrorCode::NotFound);
    }

    fn diff_paths(diff: &Diff<'_>) -> Vec<String> {
        let mut paths: Vec<String> = diff
            .deltas()
            .map(|d| {
                d.new_file()
                    .path()
                    .expect("new_file path")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn returns_staged_unstaged_and_untracked_changes() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let workdir = repo.workdir().expect("workdir");
        // Unstaged edit to a tracked file.
        fs::write(workdir.join("a.txt"), "v2\n").expect("write unstaged");
        // Staged new file: written AND added to the index, but not committed.
        fs::write(workdir.join("staged.txt"), "staged\n").expect("write staged");
        let mut index = repo.index().expect("index");
        index
            .add_path(Path::new("staged.txt"))
            .expect("stage staged.txt");
        index.write().expect("write index");
        // Untracked file: never added to the index.
        fs::write(workdir.join("untracked.txt"), "untracked\n").expect("write untracked");

        let diff = diff_working_tree(&repo).expect("diff_working_tree");

        // The staged file is the whole point: index-to-workdir would hide it.
        assert_eq!(
            diff_paths(&diff),
            vec![
                "a.txt".to_string(),
                "staged.txt".to_string(),
                "untracked.txt".to_string(),
            ]
        );
    }

    #[test]
    fn returns_empty_diff_when_working_tree_clean() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let diff = diff_working_tree(&repo).expect("diff_working_tree");
        assert_eq!(diff.deltas().count(), 0);
    }

    #[test]
    fn returns_working_tree_changes_on_unborn_branch() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        // No commit yet: HEAD is unborn. A file in the working tree must still
        // surface as an addition rather than erroring on the missing HEAD tree.
        fs::write(dir.path().join("fresh.txt"), "hello\n").expect("write file");

        let diff = diff_working_tree(&repo).expect("diff_working_tree");
        assert_eq!(diff_paths(&diff), vec!["fresh.txt".to_string()]);
    }

    #[test]
    fn returns_diff_between_base_branch_and_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());

        let base_oid = commit_file(&repo, "a.txt", "v1\n", "main: init");

        let base_commit = repo.find_commit(base_oid).expect("find_commit");
        repo.branch("feature", &base_commit, false)
            .expect("create feature branch");
        repo.set_head("refs/heads/feature")
            .expect("set HEAD to feature");

        commit_file(&repo, "a.txt", "v2\n", "feature: modify a");
        commit_file(&repo, "b.txt", "new\n", "feature: add b");

        let diff = diff_head_base(&repo, "main").expect("diff_head_base");

        let mut paths: Vec<String> = diff
            .deltas()
            .map(|d| {
                d.new_file()
                    .path()
                    .expect("new_file path")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["a.txt".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn returns_empty_diff_when_base_matches_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let diff = diff_head_base(&repo, "main").expect("diff_head_base");
        assert_eq!(diff.deltas().count(), 0);
    }

    #[test]
    fn errors_when_base_ref_missing() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", "v1\n", "init");

        let err = diff_head_base(&repo, "nonexistent")
            .err()
            .expect("should fail");
        let crate::VcsError::Git(inner) = err;
        assert_eq!(inner.code(), git2::ErrorCode::NotFound);
    }
}
