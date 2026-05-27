use git2::{Oid, Repository};

use crate::Result;

const SESSION_REF_PREFIX: &str = "refs/agent-cockpit/sessions/";
const REFLOG_MSG: &str = "agent-cockpit session ref";

/// Create `refs/agent-cockpit/sessions/<session_id>` pointing at the current
/// HEAD commit.
///
/// Idempotent: if the ref already exists at the same target, it is a no-op.
/// If it exists pointing at a different target, the underlying git2 call
/// surfaces an "exists" error rather than silently force-updating, so a
/// double-create across moving HEADs is loud.
pub fn create_session_ref(repo: &Repository, session_id: &str) -> Result<Oid> {
    let head_oid = repo.head()?.peel_to_commit()?.id();
    let ref_name = format!("{SESSION_REF_PREFIX}{session_id}");

    if let Ok(existing) = repo.find_reference(&ref_name) {
        if existing.target() == Some(head_oid) {
            return Ok(head_oid);
        }
    }

    repo.reference(&ref_name, head_oid, false, REFLOG_MSG)?;
    Ok(head_oid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VcsError;
    use git2::{RepositoryInitOptions, Signature};
    use std::path::Path;

    fn init_repo_with_commit(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        let repo = Repository::init_opts(path, &opts).expect("init fixture repo");

        let sig = Signature::now("Test", "test@example.com").expect("signature");
        let tree_id = {
            let mut index = repo.index().expect("index");
            index.write_tree().expect("write_tree")
        };
        let tree = repo.find_tree(tree_id).expect("find_tree");
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .expect("initial commit");
        drop(tree);
        repo
    }

    fn commit_empty(repo: &Repository, message: &str) -> Oid {
        let sig = Signature::now("Test", "test@example.com").expect("signature");
        let parent = repo
            .head()
            .expect("head")
            .peel_to_commit()
            .expect("peel parent");
        let tree_id = {
            let mut index = repo.index().expect("index");
            index.write_tree().expect("write_tree")
        };
        let tree = repo.find_tree(tree_id).expect("find_tree");
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .expect("follow-up commit")
    }

    #[test]
    fn creates_ref_at_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());
        let head_oid = repo.head().unwrap().peel_to_commit().unwrap().id();

        let returned = create_session_ref(&repo, "01HX0000000000000000000000")
            .expect("create_session_ref should succeed");
        assert_eq!(returned, head_oid);

        let r = repo
            .find_reference("refs/agent-cockpit/sessions/01HX0000000000000000000000")
            .expect("ref should exist");
        assert_eq!(r.target(), Some(head_oid));
    }

    #[test]
    fn ref_is_listed_under_session_prefix() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());

        create_session_ref(&repo, "abc").expect("create_session_ref");

        let mut names: Vec<String> = repo
            .references_glob("refs/agent-cockpit/sessions/*")
            .expect("glob")
            .names()
            .filter_map(|n| n.ok().map(|s| s.to_string()))
            .collect();
        names.sort();
        assert_eq!(names, vec!["refs/agent-cockpit/sessions/abc".to_string()]);
    }

    #[test]
    fn idempotent_when_called_twice_with_same_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());

        let first = create_session_ref(&repo, "id").expect("first call");
        let second = create_session_ref(&repo, "id").expect("second call");

        assert_eq!(first, second);
    }

    #[test]
    fn errors_when_ref_exists_at_different_target() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());

        create_session_ref(&repo, "id").expect("first call");

        commit_empty(&repo, "advance");

        let err =
            create_session_ref(&repo, "id").expect_err("second call should fail when HEAD moved");
        let VcsError::Git(inner) = err;
        assert_eq!(inner.code(), git2::ErrorCode::Exists);
    }
}
