use git2::{Diff, Repository};

use crate::Result;

const SESSION_REF_PREFIX: &str = "refs/agent-cockpit/sessions/";

pub fn diff_session<'repo>(repo: &'repo Repository, session_id: &str) -> Result<Diff<'repo>> {
    let session_ref_name = format!("{SESSION_REF_PREFIX}{session_id}");
    let session_ref = repo.find_reference(&session_ref_name)?;
    let session_tree = session_ref.peel_to_commit()?.tree()?;

    let head_tree = repo.head()?.peel_to_commit()?.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&session_tree), Some(&head_tree), None)?;
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
        index
            .add_path(Path::new(name))
            .expect("add_path");
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
            "refs/agent-cockpit/sessions/test-session",
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
            "refs/agent-cockpit/sessions/same",
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
}
