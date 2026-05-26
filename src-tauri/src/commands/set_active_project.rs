use std::path::PathBuf;

use crate::active_project::ActiveProject;

#[tauri::command]
pub fn set_active_project(
    repo_path: String,
    active_project: tauri::State<'_, ActiveProject>,
) -> Result<(), String> {
    let canonical = validate_repo_path(&repo_path)?;
    active_project.set(canonical);
    Ok(())
}

fn validate_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return Err("repo_path must not be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("canonicalize {}: {e}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_repo_path() {
        let err = validate_repo_path("").unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
    }

    #[test]
    fn rejects_whitespace_only_repo_path() {
        let err = validate_repo_path("   \t").unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
    }

    #[test]
    fn rejects_non_existent_repo_path() {
        let err = validate_repo_path("/does/not/exist/anywhere").unwrap_err();
        assert!(err.starts_with("canonicalize "), "got: {err}");
    }

    #[test]
    fn rejects_file_instead_of_directory() {
        let tmp = tempfile::NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_string_lossy().to_string();
        let err = validate_repo_path(&path).unwrap_err();
        assert!(err.ends_with("is not a directory"), "got: {err}");
    }

    #[test]
    fn accepts_existing_directory_and_canonicalizes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().to_string_lossy().to_string();
        let canonical = validate_repo_path(&path).expect("validate");
        assert!(canonical.is_dir());
    }
}
