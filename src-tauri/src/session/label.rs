use std::path::Path;

pub fn derive_label(binary: &str, worktree_path: &str) -> String {
    match Path::new(worktree_path)
        .file_name()
        .and_then(|s| s.to_str())
    {
        Some(segment) if !segment.is_empty() => format!("{binary} @ {segment}"),
        _ => binary.to_string(),
    }
}

#[tauri::command]
pub fn session_label(binary: String, worktree_path: String) -> String {
    derive_label(&binary, &worktree_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_path_uses_final_segment() {
        assert_eq!(
            derive_label(
                "claude",
                "/Users/walid/repos/mizraj/feat-foundations"
            ),
            "claude @ feat-foundations"
        );
    }

    #[test]
    fn root_path_falls_back_to_binary_only() {
        assert_eq!(derive_label("claude", "/"), "claude");
    }

    #[test]
    fn missing_segment_falls_back_to_binary_only() {
        assert_eq!(derive_label("claude", ""), "claude");
    }
}
