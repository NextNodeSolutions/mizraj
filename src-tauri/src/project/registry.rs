//! Registry of known repositories, persisted as JSON in the app-data dir.
//! The registry is the single source of truth for "which repos does the app
//! know about" (MP4): Mission Control lists them even without live sessions.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// The registry as Tauri managed state: one process-wide list, persisted on
/// every mutation.
pub struct SharedRegistry(Mutex<Registry>);

impl SharedRegistry {
    pub fn new(registry: Registry) -> Self {
        Self(Mutex::new(registry))
    }

    pub fn list(&self) -> Vec<PathBuf> {
        self.lock().list()
    }

    pub fn missing(&self) -> Vec<PathBuf> {
        self.lock().missing()
    }

    pub fn add(&self, path: PathBuf) -> Result<bool, String> {
        self.lock().add(path)
    }

    pub fn remove(&self, path: &Path) -> Result<(), String> {
        self.lock().remove(path)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tauri::command]
pub fn projects_list(registry: tauri::State<'_, SharedRegistry>) -> Vec<String> {
    registry
        .list()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Registered repos whose path no longer resolves to a directory on disk:
/// folders the user moved or deleted. The picker shows them as "introuvable"
/// so they can be pruned from the pool — listing them is the only way the user
/// learns the registry drifted from reality.
#[tauri::command]
pub fn projects_missing(registry: tauri::State<'_, SharedRegistry>) -> Vec<String> {
    registry
        .missing()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn projects_add(
    repo_path: String,
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRegistry>,
    watchers: tauri::State<'_, super::watcher::RepoWatchers>,
) -> Result<String, String> {
    let canonical = super::validate_repo_path(&repo_path)?;
    if registry.add(canonical.clone())? {
        super::watcher::watch_and_emit(&watchers, &app, &canonical);
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn projects_remove(
    repo_path: String,
    registry: tauri::State<'_, SharedRegistry>,
    db: tauri::State<'_, crate::db::Db>,
    watchers: tauri::State<'_, super::watcher::RepoWatchers>,
) -> Result<(), String> {
    let path = Path::new(&repo_path);
    registry.remove(path)?;
    // A removed repo releases everything it held: its watcher stops and its
    // progress pool closes; other repos keep theirs untouched.
    watchers.unwatch(path);
    db.close_for(path).await;
    Ok(())
}

#[derive(Debug)]
pub struct Registry {
    file_path: PathBuf,
    projects: Vec<PathBuf>,
}

impl Registry {
    /// Load the registry from `file_path`; a missing file is an empty registry.
    pub fn load(file_path: &Path) -> Result<Self, String> {
        let projects = match std::fs::read_to_string(file_path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|err| format!("parse {}: {err}", file_path.display()))?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(err) => return Err(format!("read {}: {err}", file_path.display())),
        };
        Ok(Self {
            file_path: file_path.to_path_buf(),
            projects,
        })
    }

    pub fn list(&self) -> Vec<PathBuf> {
        self.projects.clone()
    }

    /// Registered paths that no longer resolve to a directory on disk, in
    /// registration order. A repo that was deleted or moved lands here.
    pub fn missing(&self) -> Vec<PathBuf> {
        self.projects
            .iter()
            .filter(|path| !path.is_dir())
            .cloned()
            .collect()
    }

    /// Register `path`, persist, and report whether it was newly added.
    pub fn add(&mut self, path: PathBuf) -> Result<bool, String> {
        if self.projects.contains(&path) {
            return Ok(false);
        }
        self.projects.push(path);
        self.persist()?;
        Ok(true)
    }

    /// Forget `path` and persist; removing an unknown path is a no-op.
    pub fn remove(&mut self, path: &Path) -> Result<(), String> {
        let before = self.projects.len();
        self.projects.retain(|known| known != path);
        if self.projects.len() == before {
            return Ok(());
        }
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("create {}: {err}", parent.display()))?;
        }
        let raw = serde_json::to_string_pretty(&self.projects)
            .map_err(|err| format!("serialize registry: {err}"))?;
        std::fs::write(&self.file_path, raw)
            .map_err(|err| format!("write {}: {err}", self.file_path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_a_known_project_reports_false_and_keeps_one_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        assert!(registry.add(PathBuf::from("/tmp/repo-a")).expect("first"));
        assert!(!registry.add(PathBuf::from("/tmp/repo-a")).expect("second"));
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn a_corrupt_file_is_a_load_error_not_a_silent_wipe() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");
        std::fs::write(&file, "not json").expect("write corrupt file");

        let err = Registry::load(&file).expect_err("corrupt file should fail");
        assert!(err.starts_with("parse "), "got: {err}");
    }

    #[test]
    fn remove_forgets_the_project_durably() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        registry.add(PathBuf::from("/tmp/repo-a")).expect("add a");
        registry.add(PathBuf::from("/tmp/repo-b")).expect("add b");
        registry.remove(Path::new("/tmp/repo-a")).expect("remove a");

        let reloaded = Registry::load(&file).expect("reload");
        assert_eq!(reloaded.list(), vec![PathBuf::from("/tmp/repo-b")]);
    }

    #[test]
    fn missing_reports_only_paths_absent_from_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");
        let live = dir.path().join("live");
        std::fs::create_dir(&live).expect("mkdir live");

        let mut registry = Registry::load(&file).expect("load empty");
        registry.add(live.clone()).expect("add live");
        registry
            .add(PathBuf::from("/tmp/mizraj/definitely-gone"))
            .expect("add gone");

        assert_eq!(
            registry.missing(),
            vec![PathBuf::from("/tmp/mizraj/definitely-gone")],
        );
    }

    #[test]
    fn added_projects_survive_a_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("projects.json");

        let mut registry = Registry::load(&file).expect("load empty");
        registry
            .add(PathBuf::from("/tmp/repo-a"))
            .expect("add repo-a");

        let reloaded = Registry::load(&file).expect("reload");
        assert_eq!(reloaded.list(), vec![PathBuf::from("/tmp/repo-a")]);
    }
}
