use std::path::Path;

use agent_cockpit_vcs::{diff_head_base, diff_session, diff_working_tree, repo_open};
use serde::Deserialize;
use serde_json::Value;

use crate::active_project::ActiveProject;
use crate::diff_format::map_diff;

const DEFAULT_BASE: &str = "main";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffView {
    Session,
    WorkingTree,
    HeadBase,
}

#[tauri::command]
pub fn get_diff(
    session_id: String,
    view: DiffView,
    base: Option<String>,
    active_project: tauri::State<'_, ActiveProject>,
) -> Result<Value, String> {
    let repo_path = active_project
        .get()
        .ok_or_else(|| "no active project".to_string())?;
    get_diff_inner(&repo_path, &session_id, view, base.as_deref())
}

fn get_diff_inner(
    repo_path: &Path,
    session_id: &str,
    view: DiffView,
    base: Option<&str>,
) -> Result<Value, String> {
    let repo = repo_open(repo_path).map_err(|e| e.to_string())?;
    let diff = match view {
        DiffView::Session => diff_session(&repo, session_id),
        DiffView::WorkingTree => diff_working_tree(&repo),
        DiffView::HeadBase => diff_head_base(&repo, base.unwrap_or(DEFAULT_BASE)),
    }
    .map_err(|e| e.to_string())?;
    Ok(map_diff(&diff))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use agent_cockpit_vcs::git2::{Oid, Repository, RepositoryInitOptions, Signature};
    use tempfile::TempDir;

    use super::{get_diff_inner, DiffView};

    fn init_repo(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        Repository::init_opts(path, &opts).expect("init fixture repo")
    }

    fn commit_file(repo: &Repository, name: &str, contents: &[u8]) -> Oid {
        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join(name), contents).expect("write file");

        let mut index = repo.index().expect("index");
        index.add_path(Path::new(name)).expect("add_path");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write_tree");
        let tree = repo.find_tree(tree_id).expect("find_tree");

        let sig = Signature::now("Test", "test@example.com").expect("signature");
        let parents: Vec<_> = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&_> = parents.iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, "msg", &tree, &parent_refs)
            .expect("commit")
    }

    #[test]
    fn working_tree_view_returns_empty_patch_on_clean_repo() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");

        let value = get_diff_inner(dir.path(), "ignored", DiffView::WorkingTree, None)
            .expect("get_diff working_tree");

        assert_eq!(value["patch"].as_str(), Some(""));
    }

    #[test]
    fn working_tree_view_returns_patch_for_dirty_workdir() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");
        fs::write(dir.path().join("a.txt"), b"v2\n").expect("modify");

        let value = get_diff_inner(dir.path(), "ignored", DiffView::WorkingTree, None)
            .expect("get_diff working_tree");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(patch.contains("-v1"), "patch missing removal: {patch}");
        assert!(patch.contains("+v2"), "patch missing addition: {patch}");
    }

    #[test]
    fn session_view_returns_patch_against_session_ref() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        let session_oid = commit_file(&repo, "a.txt", b"v1\n");
        repo.reference(
            "refs/agent-cockpit/sessions/test-session",
            session_oid,
            false,
            "create session ref",
        )
        .expect("create session ref");
        commit_file(&repo, "a.txt", b"v2\n");

        let value = get_diff_inner(dir.path(), "test-session", DiffView::Session, None)
            .expect("get_diff session");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(patch.contains("a.txt"), "patch missing file: {patch}");
    }

    #[test]
    fn head_base_view_returns_patch_against_base_branch() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        let base_oid = commit_file(&repo, "a.txt", b"v1\n");
        let base_commit = repo.find_commit(base_oid).expect("find_commit");
        repo.branch("feature", &base_commit, false)
            .expect("create feature branch");
        repo.set_head("refs/heads/feature").expect("set HEAD");
        commit_file(&repo, "a.txt", b"v2\n");

        let value = get_diff_inner(dir.path(), "ignored", DiffView::HeadBase, Some("main"))
            .expect("get_diff head_base");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(patch.contains("a.txt"), "patch missing file: {patch}");
    }

    #[test]
    fn head_base_view_defaults_to_main_when_base_omitted() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        let base_oid = commit_file(&repo, "a.txt", b"v1\n");
        let base_commit = repo.find_commit(base_oid).expect("find_commit");
        repo.branch("feature", &base_commit, false)
            .expect("create feature branch");
        repo.set_head("refs/heads/feature").expect("set HEAD");
        commit_file(&repo, "a.txt", b"v2\n");

        let value = get_diff_inner(dir.path(), "ignored", DiffView::HeadBase, None)
            .expect("get_diff head_base default base");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(patch.contains("a.txt"), "patch missing file: {patch}");
    }

    #[test]
    fn returns_error_when_repo_open_fails() {
        let dir = TempDir::new().expect("tempdir");
        let err = get_diff_inner(dir.path(), "ignored", DiffView::WorkingTree, None)
            .expect_err("non-repo path should fail");
        assert!(!err.is_empty(), "error message should not be empty");
    }
}
