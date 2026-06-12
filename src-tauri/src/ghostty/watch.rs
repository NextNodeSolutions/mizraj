//! Watch the Ghostty config locations and report changes (DG3 hot reload).
//!
//! The OS watcher fires several raw events per save (editors write via
//! temp-file + rename), so a debounce thread folds each storm into a single
//! `on_change` call after [`QUIET_PERIOD`] of silence. The frontend re-pulls
//! the resolved config when notified; no payload is needed.

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Global event telling the frontend the Ghostty config changed on disk.
pub const GHOSTTY_CONFIG_CHANGED_EVENT: &str = "ghostty:config-changed";

/// Silence required after the last raw filesystem event before `on_change`
/// fires: long enough to swallow an editor's save storm, short enough to feel
/// immediate.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// Watch `dirs` recursively and invoke `on_change` once per burst of changes.
///
/// Non-existent directories are skipped (the user may have no Ghostty config
/// at all); if nothing is watchable, `None` is returned and hot reload is
/// simply off for this run. The returned watcher must be kept alive for the
/// app's lifetime — dropping it stops the notifications.
pub fn spawn_config_watcher<F>(dirs: Vec<PathBuf>, on_change: F) -> Option<RecommendedWatcher>
where
    F: Fn() + Send + 'static,
{
    let (raw_tx, raw_rx) = mpsc::channel::<()>();

    let mut watcher = match notify::recommended_watcher(move |event: notify::Result<_>| {
        if event.is_ok() {
            let _ = raw_tx.send(());
        }
    }) {
        Ok(watcher) => watcher,
        Err(err) => {
            tracing::warn!(error = %err, "ghostty config watcher init failed; hot reload off");
            return None;
        }
    };

    let mut watched = 0usize;
    for dir in dirs.iter().filter(|dir| dir.exists()) {
        match watcher.watch(dir, RecursiveMode::Recursive) {
            Ok(()) => watched += 1,
            Err(err) => {
                tracing::warn!(dir = %dir.display(), error = %err, "ghostty config dir not watchable");
            }
        }
    }
    if watched == 0 {
        tracing::info!("no ghostty config dir to watch; hot reload off");
        return None;
    }

    thread::spawn(move || debounce_loop(&raw_rx, on_change));
    Some(watcher)
}

/// Fold raw event storms: after the first event, keep draining until
/// [`QUIET_PERIOD`] passes without another one, then fire once. Exits when the
/// watcher (the sender) is dropped.
fn debounce_loop<F: Fn()>(raw_rx: &mpsc::Receiver<()>, on_change: F) {
    while raw_rx.recv().is_ok() {
        loop {
            match raw_rx.recv_timeout(QUIET_PERIOD) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        on_change();
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc::Receiver;
    use std::time::Duration;

    use tempfile::TempDir;

    use super::*;

    /// FSEvents (macOS) can take a moment to deliver; budget generously so the
    /// test is about behavior, not platform latency.
    const DELIVERY_WAIT: Duration = Duration::from_secs(5);

    fn changes_channel(dir: &TempDir) -> (RecommendedWatcher, Receiver<()>) {
        let (tx, rx) = mpsc::channel::<()>();
        let watcher = spawn_config_watcher(vec![dir.path().to_path_buf()], move || {
            let _ = tx.send(());
        })
        .expect("an existing dir must be watchable");
        (watcher, rx)
    }

    #[test]
    fn reports_a_change_when_a_config_file_is_written() {
        let dir = TempDir::new().expect("tempdir");
        let (_watcher, changes) = changes_channel(&dir);

        fs::write(dir.path().join("config"), "font-size = 14\n").expect("write config");

        changes
            .recv_timeout(DELIVERY_WAIT)
            .expect("writing a file under a watched dir must notify");
    }

    #[test]
    fn folds_a_save_storm_into_one_notification() {
        let dir = TempDir::new().expect("tempdir");
        let (_watcher, changes) = changes_channel(&dir);

        // An editor-style save storm: several writes in quick succession.
        for i in 0..5 {
            fs::write(dir.path().join("config"), format!("font-size = {i}\n"))
                .expect("write config");
        }

        changes
            .recv_timeout(DELIVERY_WAIT)
            .expect("the storm must produce a notification");
        // The whole storm fits well inside one quiet period, so exactly one
        // notification may follow — silence means the debounce held.
        assert!(
            changes.recv_timeout(QUIET_PERIOD * 4).is_err(),
            "a single save storm must fold into one notification"
        );
    }

    #[test]
    fn skips_missing_dirs_and_reports_none_when_nothing_is_watchable() {
        let ghost = PathBuf::from("/definitely/not/a/real/dir/mizraj-test");
        assert!(spawn_config_watcher(vec![ghost], || {}).is_none());
    }
}
