//! Per-repo filesystem watchers (MP6): the UI's state stays true without
//! polling. Each registered repo gets one recursive watcher over its root;
//! raw event storms (a rebase, an editor save) are debounced into a single
//! `repo-changed` emission, and `.git` internals (index.lock, objects/…)
//! are filtered out — only `HEAD`, `refs/` and worktree files matter.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Event telling the frontend a repo changed on disk.
/// Payload: `{ repoPath: string, kind: 'git' | 'worktree' | 'mixed' }`.
pub const REPO_CHANGED_EVENT: &str = "repo-changed";

/// Silence required after the last raw event before one change fires: long
/// enough to fold a 50-commit rebase into a handful of recomputes, short
/// enough that an external commit shows up in under a second.
const QUIET_PERIOD: Duration = Duration::from_millis(400);

/// What part of the repo a (debounced) change burst touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    /// `.git/HEAD` or `.git/refs/` — branch switch, commit, rebase.
    Git,
    /// Files of the working tree.
    Worktree,
    /// Both within one burst.
    Mixed,
}

impl ChangeKind {
    fn merge(self, other: ChangeKind) -> ChangeKind {
        if self == other {
            self
        } else {
            ChangeKind::Mixed
        }
    }
}

/// Classify a raw event path; `None` is `.git` noise to drop entirely
/// (index.lock, objects/, logs/…).
fn classify(path: &Path) -> Option<ChangeKind> {
    let mut components = path.components();
    let inside_git = components.by_ref().any(|part| part.as_os_str() == ".git");
    if !inside_git {
        return Some(ChangeKind::Worktree);
    }
    match components.next() {
        Some(Component::Normal(name)) if name == "HEAD" || name == "refs" => Some(ChangeKind::Git),
        _ => None,
    }
}

/// Watch `repo_path` recursively and invoke `on_change` once per debounced
/// burst with the merged [`ChangeKind`]. The returned watcher must be kept
/// alive — dropping it stops the notifications.
pub fn spawn_repo_watcher<F>(repo_path: &Path, on_change: F) -> Result<RecommendedWatcher, String>
where
    F: Fn(ChangeKind) + Send + 'static,
{
    let (raw_tx, raw_rx) = mpsc::channel::<ChangeKind>();

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        for kind in event.paths.iter().filter_map(|path| classify(path)) {
            let _ = raw_tx.send(kind);
        }
    })
    .map_err(|err| format!("watcher init for {}: {err}", repo_path.display()))?;

    watcher
        .watch(repo_path, RecursiveMode::Recursive)
        .map_err(|err| format!("watch {}: {err}", repo_path.display()))?;

    thread::spawn(move || debounce_loop(&raw_rx, on_change));
    Ok(watcher)
}

/// Fold raw event storms: after the first relevant event, keep draining (and
/// merging kinds) until [`QUIET_PERIOD`] passes silent, then fire once.
/// Exits when the watcher (the sender) is dropped.
fn debounce_loop<F: Fn(ChangeKind)>(raw_rx: &mpsc::Receiver<ChangeKind>, on_change: F) {
    while let Ok(first) = raw_rx.recv() {
        let mut merged = first;
        loop {
            match raw_rx.recv_timeout(QUIET_PERIOD) {
                Ok(kind) => merged = merged.merge(kind),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        on_change(merged);
    }
}

/// The `repo-changed` wire payload.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChangedPayload {
    pub repo_path: String,
    pub kind: ChangeKind,
}

/// Start watching `repo_path` and emit [`REPO_CHANGED_EVENT`] to the whole
/// app on every debounced change. The one wiring point between the watcher
/// map and Tauri's event bus — registry hooks and startup both go through
/// here.
pub fn watch_and_emit<R: tauri::Runtime>(
    watchers: &RepoWatchers,
    app: &tauri::AppHandle<R>,
    repo_path: &Path,
) {
    use tauri::Emitter;

    let app = app.clone();
    let repo = repo_path.to_string_lossy().into_owned();
    watchers.watch(repo_path, move |kind| {
        let payload = RepoChangedPayload {
            repo_path: repo.clone(),
            kind,
        };
        if let Err(err) = app.emit(REPO_CHANGED_EVENT, payload) {
            tracing::warn!(error = %err, "repo-changed emit failed");
        }
    });
}

/// The live watchers, one per registered repo — Tauri managed state. The
/// registry drives this map: `projects_add`/startup start a watcher,
/// `projects_remove` stops one (dropping the watcher ends its thread).
#[derive(Default)]
pub struct RepoWatchers(Mutex<HashMap<PathBuf, RecommendedWatcher>>);

impl RepoWatchers {
    /// Start watching `repo_path`; replaces any previous watcher for it.
    /// A repo that cannot be watched (deleted from disk) logs once and is
    /// skipped — never a panic.
    pub fn watch<F>(&self, repo_path: &Path, on_change: F)
    where
        F: Fn(ChangeKind) + Send + 'static,
    {
        match spawn_repo_watcher(repo_path, on_change) {
            Ok(watcher) => {
                self.lock().insert(repo_path.to_path_buf(), watcher);
            }
            Err(err) => {
                tracing::error!(repo = %repo_path.display(), error = %err, "repo watcher failed to start");
            }
        }
    }

    /// Stop watching `repo_path`; unknown repos are a no-op.
    pub fn unwatch(&self, repo_path: &Path) {
        self.lock().remove(repo_path);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, RecommendedWatcher>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc::Receiver;

    use tempfile::TempDir;

    use super::*;

    /// FSEvents (macOS) can take a moment to deliver; budget generously so
    /// the tests are about behavior, not platform latency.
    const DELIVERY_WAIT: Duration = Duration::from_secs(5);

    fn changes_channel(dir: &TempDir) -> (RecommendedWatcher, Receiver<ChangeKind>) {
        let (tx, rx) = mpsc::channel::<ChangeKind>();
        let watcher = spawn_repo_watcher(dir.path(), move |kind| {
            let _ = tx.send(kind);
        })
        .expect("an existing dir must be watchable");
        (watcher, rx)
    }

    #[test]
    fn a_worktree_write_emits_one_worktree_change() {
        let dir = TempDir::new().expect("tempdir");
        let (_watcher, changes) = changes_channel(&dir);

        fs::write(dir.path().join("main.rs"), "fn main() {}\n").expect("write");

        assert_eq!(
            changes.recv_timeout(DELIVERY_WAIT).expect("one change"),
            ChangeKind::Worktree
        );
    }

    #[test]
    fn a_burst_of_writes_folds_into_one_change() {
        let dir = TempDir::new().expect("tempdir");
        let (_watcher, changes) = changes_channel(&dir);

        for i in 0..10 {
            fs::write(dir.path().join(format!("file-{i}.txt")), "x").expect("write");
        }

        changes
            .recv_timeout(DELIVERY_WAIT)
            .expect("the burst must produce a change");
        assert!(
            changes.recv_timeout(QUIET_PERIOD * 4).is_err(),
            "one burst must fold into one change"
        );
    }

    #[test]
    fn git_head_changes_are_git_kind_and_internals_are_dropped() {
        let dir = TempDir::new().expect("tempdir");
        let git = dir.path().join(".git");
        fs::create_dir_all(git.join("objects")).expect("mkdir objects");
        fs::create_dir_all(git.join("refs/heads")).expect("mkdir refs");
        let (_watcher, changes) = changes_channel(&dir);

        // Noise: object writes and index.lock must not emit anything.
        fs::write(git.join("objects/abc123"), "blob").expect("write object");
        fs::write(git.join("index.lock"), "").expect("write lock");
        assert!(
            changes.recv_timeout(QUIET_PERIOD * 4).is_err(),
            ".git internals must be filtered out"
        );

        fs::write(git.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD");
        assert_eq!(
            changes.recv_timeout(DELIVERY_WAIT).expect("HEAD change"),
            ChangeKind::Git
        );
    }

    #[test]
    fn classify_filters_git_internals_and_keeps_head_refs_worktree() {
        assert_eq!(
            classify(Path::new("/repo/src/main.rs")),
            Some(ChangeKind::Worktree)
        );
        assert_eq!(
            classify(Path::new("/repo/.git/HEAD")),
            Some(ChangeKind::Git)
        );
        assert_eq!(
            classify(Path::new("/repo/.git/refs/heads/main")),
            Some(ChangeKind::Git)
        );
        assert_eq!(classify(Path::new("/repo/.git/index.lock")), None);
        assert_eq!(classify(Path::new("/repo/.git/objects/ab/cdef")), None);
        assert_eq!(classify(Path::new("/repo/.git/logs/HEAD")), None);
    }

    #[test]
    fn unwatch_stops_the_notifications() {
        let dir = TempDir::new().expect("tempdir");
        let (tx, rx) = mpsc::channel::<ChangeKind>();
        let watchers = RepoWatchers::default();
        watchers.watch(dir.path(), move |kind| {
            let _ = tx.send(kind);
        });

        fs::write(dir.path().join("alive.txt"), "x").expect("write");
        rx.recv_timeout(DELIVERY_WAIT)
            .expect("watching must notify");

        watchers.unwatch(dir.path());
        fs::write(dir.path().join("dead.txt"), "x").expect("write");
        assert!(
            rx.recv_timeout(QUIET_PERIOD * 4).is_err(),
            "after unwatch no change may arrive"
        );
    }

    #[test]
    fn watching_a_missing_dir_logs_and_does_not_panic() {
        let watchers = RepoWatchers::default();
        watchers.watch(Path::new("/definitely/not/here/mizraj"), |_| {});
        assert!(watchers.lock().is_empty());
    }
}
