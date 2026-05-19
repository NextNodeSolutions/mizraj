use std::path::Path;

pub type InterviewState = serde_json::Value;

fn read_state_from(base: &Path, slug: &str) -> Result<InterviewState, String> {
    let path = base.join(slug).join("state.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))
}

#[tauri::command]
pub fn read_interview_state(slug: String) -> Result<InterviewState, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    read_state_from(&cwd.join("docs").join("interviews"), &slug)
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
}
