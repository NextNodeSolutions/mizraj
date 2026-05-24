use std::path::PathBuf;

use crate::active_project::ActiveProject;

#[tauri::command]
pub fn set_active_project(repo_path: String, active_project: tauri::State<'_, ActiveProject>) {
    active_project.set(PathBuf::from(repo_path));
}
