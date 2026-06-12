//! Host bridge between the Tauri app and the `mizraj-config` crate.
//!
//! `mizraj-config` is deliberately platform-path-free; this module resolves the
//! concrete Ghostty config/theme locations from the environment, loads the
//! effective config, and exposes it to the frontend via the `load_ghostty_config`
//! command. The pure `ResolvedConfig -> wire DTO` mapping lives in [`dto`].

mod dto;
mod watch;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mizraj_config::{load, Appearance, LoadOptions};
use notify::RecommendedWatcher;
use tauri::{AppHandle, Emitter, Runtime};

use dto::{build_dto, GhosttyConfigDto};
use watch::{spawn_config_watcher, GHOSTTY_CONFIG_CHANGED_EVENT};

/// The directory that holds `$XDG_CONFIG_HOME/ghostty` (defaulting XDG to
/// `$HOME/.config`).
fn xdg_ghostty_dir(home: &Path, xdg_config_home: Option<&Path>) -> PathBuf {
    match xdg_config_home {
        Some(xdg) if !xdg.as_os_str().is_empty() => xdg.join("ghostty"),
        _ => home.join(".config").join("ghostty"),
    }
}

/// The two file names Ghostty accepts in each config directory, in load order.
fn config_files_in(dir: &Path) -> [PathBuf; 2] {
    [dir.join("config"), dir.join("config.ghostty")]
}

/// The user-editable Ghostty config directories, in load order: the XDG dir
/// always, plus the macOS Application Support location. These are both the
/// roots the loader reads from and the roots the hot-reload watcher observes
/// (their `themes/` subdirs included, by recursion).
fn user_config_dirs() -> Vec<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
    let mut dirs = vec![xdg_ghostty_dir(&home, xdg.as_deref())];

    #[cfg(target_os = "macos")]
    dirs.push(
        home.join("Library")
            .join("Application Support")
            .join("com.mitchellh.ghostty"),
    );

    dirs
}

/// Resolve the Ghostty config files (load order) and theme search dirs from the
/// environment. macOS adds the Application Support locations and the installed
/// Ghostty app's bundled themes; Linux adds the system theme dir.
fn load_options(appearance: Appearance) -> LoadOptions {
    let config_dirs = user_config_dirs();
    let mut theme_dirs: Vec<PathBuf> = config_dirs.iter().map(|dir| dir.join("themes")).collect();

    #[cfg(target_os = "macos")]
    {
        // Best-effort secondary source for a default Ghostty install. This is a
        // fallback only: M1 bundles the theme corpus inside the app so parity
        // does not depend on an external Ghostty install or its exact location
        // (Homebrew Cask, a moved app, … are not covered by this single path).
        theme_dirs.push(PathBuf::from(
            "/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        theme_dirs.push(PathBuf::from("/usr/share/ghostty/themes"));
    }

    let config_files = config_dirs
        .iter()
        .flat_map(|dir| config_files_in(dir))
        .collect();

    LoadOptions {
        config_files,
        theme_dirs,
        appearance,
    }
}

/// Keeps the config watcher alive for the app's lifetime (dropping a `notify`
/// watcher silently stops its notifications). Managed as Tauri state; `None`
/// when no config directory exists, in which case hot reload is simply off.
pub struct ConfigWatchGuard(#[allow(dead_code)] Mutex<Option<RecommendedWatcher>>);

/// Watch the user's Ghostty config directories and broadcast
/// `ghostty:config-changed` on every (debounced) change so the frontend
/// re-pulls the resolved config (DG3 hot reload).
pub fn start_config_watcher<R: Runtime>(app: &AppHandle<R>) -> ConfigWatchGuard {
    let emitter = app.clone();
    let watcher = spawn_config_watcher(user_config_dirs(), move || {
        let _ = emitter.emit(GHOSTTY_CONFIG_CHANGED_EVENT, ());
    });
    ConfigWatchGuard(Mutex::new(watcher))
}

fn parse_appearance(value: &str) -> Appearance {
    match value {
        "light" => Appearance::Light,
        _ => Appearance::Dark,
    }
}

/// Approximate Ghostty's byte-based `scrollback-limit` in libghostty's
/// line-based retention: bytes / 80 (a typical text line), clamped to sane
/// bounds. Exact byte accounting would require owning the ring; the deviation
/// is recorded in the implementation notes.
const SCROLLBACK_BYTES_PER_LINE: u64 = 80;
const SCROLLBACK_MIN_LINES: u64 = 100;
const SCROLLBACK_MAX_LINES: u64 = 10_000_000;

pub fn scrollback_lines() -> usize {
    let config = load(&load_options(Appearance::Dark));
    let Some(limit_bytes) = config.scrollback_limit else {
        return mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES;
    };
    let lines =
        (limit_bytes / SCROLLBACK_BYTES_PER_LINE).clamp(SCROLLBACK_MIN_LINES, SCROLLBACK_MAX_LINES);
    usize::try_from(lines).unwrap_or(mizraj_term::DEFAULT_MAX_SCROLLBACK_LINES)
}

/// Load the user's effective Ghostty config for the given system appearance
/// (`"light"` / `"dark"`). Never fails on a bad config — problems ride along in
/// `diagnostics` so the terminal still starts.
#[tauri::command]
pub fn load_ghostty_config(appearance: String) -> GhosttyConfigDto {
    let options = load_options(parse_appearance(&appearance));
    build_dto(load(&options))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_files_in_returns_both_names_in_order() {
        let files = config_files_in(Path::new("/x/ghostty"));
        assert_eq!(files[0], PathBuf::from("/x/ghostty/config"));
        assert_eq!(files[1], PathBuf::from("/x/ghostty/config.ghostty"));
    }

    #[test]
    fn xdg_dir_prefers_xdg_config_home_over_default() {
        let home = Path::new("/home/u");
        assert_eq!(
            xdg_ghostty_dir(home, Some(Path::new("/custom/xdg"))),
            PathBuf::from("/custom/xdg/ghostty")
        );
        assert_eq!(
            xdg_ghostty_dir(home, None),
            PathBuf::from("/home/u/.config/ghostty")
        );
    }
}
