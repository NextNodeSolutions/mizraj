use git2::Repository;

use crate::Result;

const HEADS_PREFIX: &str = "refs/heads/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Head {
    Branch(String),
    Detached,
}

pub fn current_branch(repo: &Repository) -> Result<Head> {
    let head = repo.find_reference("HEAD")?;
    match head.symbolic_target() {
        Some(target) => {
            let name = target.strip_prefix(HEADS_PREFIX).unwrap_or(target);
            Ok(Head::Branch(name.to_string()))
        }
        None => Ok(Head::Detached),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{RepositoryInitOptions, Signature};
    use std::path::Path;

    fn init_repo(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        Repository::init_opts(path, &opts).expect("init fixture repo")
    }

    fn init_repo_with_commit(path: &Path) -> Repository {
        let repo = init_repo(path);
        {
            let sig = Signature::now("Test", "test@example.com").expect("signature");
            let tree_id = {
                let mut index = repo.index().expect("index");
                index.write_tree().expect("write_tree")
            };
            let tree = repo.find_tree(tree_id).expect("find_tree");
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .expect("initial commit");
        }
        repo
    }

    #[test]
    fn returns_branch_name_on_unborn_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo(dir.path());

        let head = current_branch(&repo).expect("current_branch should succeed on unborn HEAD");
        assert_eq!(head, Head::Branch("main".to_string()));
    }

    #[test]
    fn returns_branch_name_on_attached_head() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());

        let head = current_branch(&repo).expect("current_branch should succeed");
        assert_eq!(head, Head::Branch("main".to_string()));
    }

    #[test]
    fn returns_detached_when_head_is_detached() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let repo = init_repo_with_commit(dir.path());
        let oid = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(oid).expect("set_head_detached");

        let head = current_branch(&repo).expect("current_branch should succeed");
        assert_eq!(head, Head::Detached);
    }
}
