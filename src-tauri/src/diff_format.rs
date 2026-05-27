use agent_cockpit_vcs::git2::{Diff, DiffFormat};
use serde_json::{json, Value};

/// Serialize a `git2::Diff` into a payload consumable by `@pierre/diffs`.
///
/// Returns `{"patch": "<unified diff text>"}`. The frontend feeds `patch`
/// into `parsePatchFiles` from `@pierre/diffs` to obtain the
/// `FileDiffMetadata` shape the library renders. We delegate parsing to the
/// library on purpose: reimplementing its patch parser in Rust would
/// duplicate a complex pre-existing solution and drift with its internals.
pub fn map_diff(diff: &Diff<'_>) -> Value {
    let mut text = String::new();
    if let Err(err) = diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') {
            text.push(origin);
        }
        if let Ok(s) = std::str::from_utf8(line.content()) {
            text.push_str(s);
        }
        true
    }) {
        tracing::warn!(error = %err, "Diff::print failed in map_diff");
    }
    json!({ "patch": text })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use agent_cockpit_vcs::diff::diff_working_tree;
    use agent_cockpit_vcs::git2::{Repository, RepositoryInitOptions, Signature};
    use serde_json::json;
    use tempfile::TempDir;

    use super::map_diff;

    fn init_repo(path: &Path) -> Repository {
        let mut opts = RepositoryInitOptions::new();
        opts.external_template(false);
        opts.initial_head("main");
        Repository::init_opts(path, &opts).expect("init fixture repo")
    }

    fn commit_file(repo: &Repository, name: &str, contents: &[u8]) {
        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join(name), contents).expect("write fixture file");

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
    fn empty_diff_maps_to_empty_patch() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");

        let diff = diff_working_tree(&repo).expect("diff_working_tree");
        let mapped = map_diff(&diff);

        assert_eq!(mapped, json!({ "patch": "" }));
    }

    #[test]
    fn snapshot_modified_file_patch() {
        let dir = TempDir::new().expect("tempdir");
        let repo = init_repo(dir.path());
        commit_file(&repo, "a.txt", b"v1\n");

        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join("a.txt"), b"v2\n").expect("modify file");

        let diff = diff_working_tree(&repo).expect("diff_working_tree");
        let mapped = map_diff(&diff);

        // Compute the abbreviated OIDs git2 will embed in the `index` line so
        // the snapshot stays deterministic across git2 versions.
        let v1_short = short_oid(&repo, b"v1\n");
        let v2_short = short_oid(&repo, b"v2\n");
        let expected = format!(
            "diff --git a/a.txt b/a.txt\n\
             index {v1_short}..{v2_short} 100644\n\
             --- a/a.txt\n\
             +++ b/a.txt\n\
             @@ -1 +1 @@\n\
             -v1\n\
             +v2\n"
        );

        assert_eq!(
            mapped["patch"].as_str().expect("patch is a string"),
            expected
        );
    }

    fn short_oid(repo: &Repository, contents: &[u8]) -> String {
        let oid = repo.blob(contents).expect("blob");
        oid.to_string().chars().take(7).collect()
    }
}
