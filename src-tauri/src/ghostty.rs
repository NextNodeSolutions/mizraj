//! Host bridge between the Tauri app and the `mizraj-config` crate.
//!
//! `mizraj-config` is deliberately platform-path-free; this module resolves the
//! concrete Ghostty config/theme locations from the environment, loads the
//! effective config, and exposes it to the frontend via the `load_ghostty_config`
//! command. The pure `ResolvedConfig -> wire DTO` mapping lives in [`dto`].

mod dto;

use std::path::{Path, PathBuf};

use mizraj_config::{load, Appearance, LoadOptions};

use dto::{build_dto, GhosttyConfigDto};

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

/// Resolve the Ghostty config files (load order) and theme search dirs from the
/// environment. macOS adds the Application Support locations and the installed
/// Ghostty app's bundled themes; Linux adds the system theme dir.
fn load_options(appearance: Appearance) -> LoadOptions {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
    let ghostty_dir = xdg_ghostty_dir(&home, xdg.as_deref());

    let mut config_dirs = vec![ghostty_dir.clone()];
    let mut theme_dirs = vec![ghostty_dir.join("themes")];

    #[cfg(target_os = "macos")]
    {
        let support = home
            .join("Library")
            .join("Application Support")
            .join("com.mitchellh.ghostty");
        theme_dirs.push(support.join("themes"));
        config_dirs.push(support);
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

fn parse_appearance(value: &str) -> Appearance {
    match value {
        "light" => Appearance::Light,
        _ => Appearance::Dark,
    }
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
