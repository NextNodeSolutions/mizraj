use std::path::Path;

use agent_cockpit_vcs::{diff_working_tree, repo_open};
use serde_json::Value;

use crate::active_project::ActiveProject;
use crate::diff_format::map_diff;

/// Return the active project's uncommitted changes — staged, unstaged, and
/// untracked, all relative to `HEAD` — as a `@pierre/diffs` patch payload.
///
/// The multi-view selector (session / HEAD-vs-base) was removed; this command
/// now serves the single working-tree diff. `diff_session` / `diff_head_base`
/// remain in the vcs crate for when the diff views are rebuilt.
#[tauri::command]
pub fn get_diff(active_project: tauri::State<'_, ActiveProject>) -> Result<Value, String> {
    let repo_path = active_project
        .get()
        .ok_or_else(|| "no active project".to_string())?;
    get_diff_inner(&repo_path)
}

fn get_diff_inner(repo_path: &Path) -> Result<Value, String> {
    let repo = repo_open(repo_path).map_err(|e| e.to_string())?;
    let diff = diff_working_tree(&repo).map_err(|e| e.to_string())?;
    Ok(map_diff(&diff))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use agent_cockpit_vcs::git2::{Repository, RepositoryInitOptions, Signature};
    use tempfile::TempDir;

    use super::get_diff_inner;

    fn init_repo(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        Repository::init_opts(path, &opts).expect("init fixture repo")
    }

    fn commit_file(repo: &Repository, name: &str, contents: &[u8]) {
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
            .expect("commit");
    }

    #[test]
    fn returns_empty_patch_on_clean_repo() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");

        let value = get_diff_inner(dir.path()).expect("get_diff");

        assert_eq!(value["patch"].as_str(), Some(""));
    }

    #[test]
    fn returns_patch_for_dirty_workdir() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");
        fs::write(dir.path().join("a.txt"), b"v2\n").expect("modify");

        let value = get_diff_inner(dir.path()).expect("get_diff");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(patch.contains("-v1"), "patch missing removal: {patch}");
        assert!(patch.contains("+v2"), "patch missing addition: {patch}");
    }

    #[test]
    fn includes_staged_changes() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");

        // Stage a brand-new file without committing. The old index-to-workdir
        // diff hid staged changes; the working-tree diff must surface them.
        fs::write(dir.path().join("staged.txt"), b"staged\n").expect("write staged");
        let mut index = repo.index().expect("index");
        index
            .add_path(Path::new("staged.txt"))
            .expect("stage staged.txt");
        index.write().expect("write index");

        let value = get_diff_inner(dir.path()).expect("get_diff");

        let patch = value["patch"].as_str().expect("patch is a string");
        assert!(
            patch.contains("staged.txt"),
            "patch missing staged file: {patch}"
        );
    }

    #[test]
    fn returns_error_when_repo_open_fails() {
        let dir = TempDir::new().expect("tempdir");
        let err = get_diff_inner(dir.path()).expect_err("non-repo path should fail");
        assert!(!err.is_empty(), "error message should not be empty");
    }
}
