use std::path::{Path, PathBuf};
use std::process::Command;

use mizraj_vcs::git2;
use mizraj_vcs::{
    current_branch, diff_head_base, diff_session, diff_working_tree, repo_open, worktree_list, Head,
};
use tempfile::TempDir;

struct Fixture {
    _tmp: TempDir,
    repo_path: PathBuf,
}

fn seed_fixture() -> Fixture {
    let tmp = tempfile::tempdir().expect("create tempdir");
    let setup = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-repo/setup.sh");

    let output = Command::new("bash")
        .arg(&setup)
        .arg(tmp.path())
        .output()
        .expect("run setup.sh");
    assert!(
        output.status.success(),
        "setup.sh failed: status={} stdout={} stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    let repo_path = tmp.path().join("repo");
    Fixture {
        _tmp: tmp,
        repo_path,
    }
}

fn delta_paths(diff: &git2::Diff<'_>) -> Vec<String> {
    let mut paths: Vec<String> = diff
        .deltas()
        .map(|d| {
            d.new_file()
                .path()
                .or_else(|| d.old_file().path())
                .expect("delta path")
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    paths.sort();
    paths
}

#[test]
fn end_to_end_vcs_api_on_seeded_fixture() {
    let fx = seed_fixture();
    let repo = repo_open(&fx.repo_path).expect("repo_open");

    let head = current_branch(&repo).expect("current_branch");
    assert_eq!(head, Head::Branch("main".to_string()));

    let session_diff = diff_session(&repo, "sample").expect("diff_session");
    assert_eq!(delta_paths(&session_diff), vec!["a.txt".to_string()]);

    let wt_diff = diff_working_tree(&repo).expect("diff_working_tree");
    assert_eq!(
        delta_paths(&wt_diff),
        vec!["a.txt".to_string(), "c.txt".to_string()],
    );

    let head_diff = diff_head_base(&repo, "feature").expect("diff_head_base");
    assert_eq!(delta_paths(&head_diff), vec!["b.txt".to_string()]);

    let worktrees = worktree_list(&repo).expect("worktree_list");
    assert_eq!(worktrees.len(), 1);
    assert_eq!(worktrees[0].name, "locked");
    assert_eq!(worktrees[0].head, Head::Branch("locked".to_string()));
    assert!(worktrees[0].locked);
}
