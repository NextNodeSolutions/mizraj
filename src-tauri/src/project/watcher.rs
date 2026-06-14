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
        // A linked worktree's HEAD/refs live under `.git/worktrees/<name>/`;
        // a branch switch there must still emit, or a worktree session never
        // sees its own checkout move. Skip the `<name>` segment, then match
        // HEAD/refs the same way as the main checkout's `.git/`.
        Some(Component::Normal(name)) if name == "worktrees" => {
            let _worktree_name = components.next();
            match components.next() {
                Some(Component::Normal(inner)) if inner == "HEAD" || inner == "refs" => {
                    Some(ChangeKind::Git)
                }
                _ => None,
            }
        }
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

/// The most repos watched at once. Generous on purpose: a user juggling a
/// handful of repos never trips it, so eviction is rare. Bounds the live thread
/// and file-handle count `notify` holds — past the cap the least-recently-used
/// watcher is dropped (ending its debounce thread); that repo simply re-watches
/// on its next `watch` call.
const MAX_WATCHERS: usize = 32;

/// The live watchers, one per registered repo — Tauri managed state. The
/// registry drives this map: `projects_add`/startup start a watcher,
/// `projects_remove` stops one (dropping the watcher ends its thread). An LRU
/// recency list bounds the live set at [`MAX_WATCHERS`].
#[derive(Default)]
pub struct RepoWatchers(Mutex<WatcherSet>);

#[derive(Default)]
struct WatcherSet {
    watchers: HashMap<PathBuf, RecommendedWatcher>,
    /// Least-recently-used first, most-recently-used last.
    recency: Vec<PathBuf>,
}

impl WatcherSet {
    /// Move `repo_path` to the most-recently-used end of the recency list.
    fn touch(&mut self, repo_path: &Path) {
        self.recency.retain(|p| p != repo_path);
        self.recency.push(repo_path.to_path_buf());
    }
}

impl RepoWatchers {
    /// Start watching `repo_path`. Idempotent: if a watcher already exists for
    /// it, this only marks it recently-used and returns — it never spawns a
    /// second watcher/thread (callers dedup via `registry.add() == true`, so a
    /// double-watch is a no-op rather than a leak). A repo that cannot be
    /// watched (deleted from disk) logs once and is skipped — never a panic.
    /// Past [`MAX_WATCHERS`] the least-recently-used watcher is dropped first.
    pub fn watch<F>(&self, repo_path: &Path, on_change: F)
    where
        F: Fn(ChangeKind) + Send + 'static,
    {
        let mut set = self.lock();
        if set.watchers.contains_key(repo_path) {
            set.touch(repo_path);
            return;
        }
        match spawn_repo_watcher(repo_path, on_change) {
            Ok(watcher) => {
                set.watchers.insert(repo_path.to_path_buf(), watcher);
                set.touch(repo_path);
                evict_over_cap(&mut set);
            }
            Err(err) => {
                tracing::error!(repo = %repo_path.display(), error = %err, "repo watcher failed to start");
            }
        }
    }

    /// Stop watching `repo_path`; unknown repos are a no-op.
    pub fn unwatch(&self, repo_path: &Path) {
        let mut set = self.lock();
        set.recency.retain(|p| p != repo_path);
        set.watchers.remove(repo_path);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, WatcherSet> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// When the set grew past [`MAX_WATCHERS`], drop the least-recently-used
/// watcher. Dropping the `RecommendedWatcher` unwatches its repo and ends its
/// debounce thread.
fn evict_over_cap(set: &mut WatcherSet) {
    while set.watchers.len() > MAX_WATCHERS && !set.recency.is_empty() {
        let victim = set.recency.remove(0);
        if set.watchers.remove(&victim).is_some() {
            tracing::debug!(repo = %victim.display(), "dropped least-recently-used watcher past the cap; it re-watches on next access");
        }
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
        assert!(watchers.lock().watchers.is_empty());
    }

    #[test]
    fn classify_treats_linked_worktree_head_and_refs_as_git() {
        assert_eq!(
            classify(Path::new("/repo/.git/worktrees/feat/HEAD")),
            Some(ChangeKind::Git)
        );
        assert_eq!(
            classify(Path::new("/repo/.git/worktrees/feat/refs/heads/feat")),
            Some(ChangeKind::Git)
        );
        // Internals under a linked worktree's gitdir stay noise.
        assert_eq!(classify(Path::new("/repo/.git/worktrees/feat/index")), None);
    }

    #[test]
    fn watch_is_idempotent_and_does_not_replace_the_existing_watcher() {
        let dir = TempDir::new().expect("tempdir");
        let watchers = RepoWatchers::default();

        watchers.watch(dir.path(), |_| {});
        let first = {
            let set = watchers.lock();
            assert_eq!(set.watchers.len(), 1);
            // Identify the watcher by pointer so we can prove it was not replaced.
            set.watchers.get(dir.path()).map(|w| w as *const _ as usize)
        };

        // A second watch of the same repo must NOT spawn a second watcher.
        watchers.watch(dir.path(), |_| {});
        let second = {
            let set = watchers.lock();
            assert_eq!(set.watchers.len(), 1, "no second watcher is spawned");
            set.watchers.get(dir.path()).map(|w| w as *const _ as usize)
        };
        assert_eq!(first, second, "the existing watcher is kept, not replaced");
    }

    #[test]
    fn watching_past_the_cap_evicts_the_least_recently_used_watcher() {
        let dirs: Vec<TempDir> = (0..MAX_WATCHERS)
            .map(|_| TempDir::new().expect("tempdir"))
            .collect();
        let watchers = RepoWatchers::default();
        for dir in &dirs {
            watchers.watch(dir.path(), |_| {});
        }
        assert_eq!(watchers.lock().watchers.len(), MAX_WATCHERS);

        // Touch the first repo so it is no longer the LRU victim.
        watchers.watch(dirs[0].path(), |_| {});

        let extra = TempDir::new().expect("tempdir");
        watchers.watch(extra.path(), |_| {});

        let set = watchers.lock();
        assert_eq!(set.watchers.len(), MAX_WATCHERS, "cap holds steady");
        assert!(
            set.watchers.contains_key(dirs[0].path()),
            "the freshly-touched repo survives eviction"
        );
        assert!(
            !set.watchers.contains_key(dirs[1].path()),
            "the least-recently-used watcher was dropped"
        );
        assert!(
            set.watchers.contains_key(extra.path()),
            "the newcomer is watched"
        );
    }
}
