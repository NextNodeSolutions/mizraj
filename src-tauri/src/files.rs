use std::path::Path;

use crate::active_project::ActiveProject;
use crate::commands::plan_protocol::is_safe_slug;

pub type InterviewState = serde_json::Value;

const ERR_NO_ACTIVE_PROJECT: &str = "no active project: call set_active_project first";
const ERR_INVALID_SLUG: &str =
    "invalid slug: only ASCII alphanumeric, '-' and '_' are allowed (1..=128 chars)";

fn read_state_from(base: &Path, slug: &str) -> Result<InterviewState, String> {
    if !is_safe_slug(slug) {
        return Err(ERR_INVALID_SLUG.to_string());
    }
    let path = base.join(slug).join("state.json");
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))
}

#[tauri::command]
pub fn read_interview_state(
    active_project: tauri::State<'_, ActiveProject>,
    slug: String,
) -> Result<InterviewState, String> {
    let root = active_project
        .get()
        .ok_or_else(|| ERR_NO_ACTIVE_PROJECT.to_string())?;
    read_state_from(&root.join("docs").join("interviews"), &slug)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn reads_fixture_state() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let state = read_state_from(&base, "sample-interview").expect("read state");
        assert_eq!(state["slug"], "sample-interview");
        assert_eq!(state["phase"], "sealed");
        assert_eq!(state["rounds_completed"], 1);
    }

    #[test]
    fn missing_slug_returns_error() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let err = read_state_from(&base, "does-not-exist").unwrap_err();
        assert!(err.starts_with("read "));
    }

    #[test]
    fn rejects_traversal_slug() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let err = read_state_from(&base, "../etc/passwd").unwrap_err();
        assert_eq!(err, ERR_INVALID_SLUG);
    }

    #[test]
    fn rejects_separator_slug() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        assert_eq!(
            read_state_from(&base, "foo/bar").unwrap_err(),
            ERR_INVALID_SLUG
        );
        assert_eq!(
            read_state_from(&base, "foo\\bar").unwrap_err(),
            ERR_INVALID_SLUG
        );
    }

    #[test]
    fn rejects_empty_slug() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        assert_eq!(read_state_from(&base, "").unwrap_err(), ERR_INVALID_SLUG);
    }

    #[test]
    fn rejects_oversized_slug() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let long = "a".repeat(129);
        assert_eq!(read_state_from(&base, &long).unwrap_err(), ERR_INVALID_SLUG);
    }

    #[test]
    fn accepts_kebab_snake_alphanumeric() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        // Slugs that pass validation but don't exist on disk; the error must
        // come from the filesystem layer, not the slug check.
        for slug in ["valid-but-missing", "valid_but_missing", "Valid123"] {
            let err = read_state_from(&base, slug).unwrap_err();
            assert!(
                err.starts_with("read "),
                "slug {slug:?} should be rejected only by fs, not by validation, got {err:?}",
            );
        }
    }
}
