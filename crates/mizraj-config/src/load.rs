//! Load a Ghostty config from disk into a [`ResolvedConfig`].
//!
//! Steps, in order: read each discovered config file; expand its `config-file`
//! includes (relative to the including file, `?`-optional, cycle-guarded, and —
//! per Ghostty — appended at end-of-file so they override later keys in the
//! including file); resolve a `theme = …` directive to a theme file applied as a
//! *base* layer (so explicit user keys win); then fold everything via
//! [`resolve`]. Anything missing or broken becomes a [`Diagnostic`] rather than a
//! hard error, so a config typo never stops the terminal from starting.
//!
//! This crate stays free of platform path logic: the host resolves the concrete
//! `config_files` / `theme_dirs` (`$XDG_CONFIG_HOME`, `$HOME`, macOS Application
//! Support, bundled themes) and passes them in via [`LoadOptions`].

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::diagnostic::Diagnostic;
use crate::parse::{parse, Directive};
use crate::resolve::{resolve, ResolvedConfig};

/// System appearance, used to pick the side of a `theme = light:…,dark:…`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

/// Where to load from. The host resolves these from the platform paths.
#[derive(Debug, Clone)]
pub struct LoadOptions {
    /// Base config files, in load order (later overrides earlier). Non-existent
    /// entries are skipped silently — Ghostty falls back to defaults.
    pub config_files: Vec<PathBuf>,
    /// Directories searched, in order, to resolve a non-absolute `theme = name`.
    pub theme_dirs: Vec<PathBuf>,
    pub appearance: Appearance,
}

/// Load and resolve the effective config described by `options`.
pub fn load(options: &LoadOptions) -> ResolvedConfig {
    let mut diagnostics = Vec::new();
    let mut directives = Vec::new();
    // Shared across every base file so a fragment included by more than one of
    // them (e.g. both `config` and `config.ghostty`) is parsed once, not twice —
    // double-parsing would double-count accumulating keys (font-family, palette).
    let mut visited = HashSet::new();

    for path in &options.config_files {
        if path.exists() {
            expand_file(path, &mut directives, &mut diagnostics, &mut visited);
        }
    }

    // A theme is a base layer: prepend its directives so the user's own keys,
    // which come later in load order, override it.
    let theme = last_value(&directives, "theme")
        .and_then(|value| load_theme(&value, options, &mut diagnostics));
    if let Some(mut theme_directives) = theme {
        theme_directives.append(&mut directives);
        directives = theme_directives;
    }

    let mut config = resolve(&directives);
    config.diagnostics.extend(diagnostics);
    config
}

/// Read `path`, emit its own directives, then expand its includes at the end.
fn expand_file(
    path: &Path,
    out: &mut Vec<Directive>,
    diagnostics: &mut Vec<Diagnostic>,
    visited: &mut HashSet<PathBuf>,
) {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !visited.insert(canonical) {
        diagnostics.push(Diagnostic::new(
            "config-file",
            path.display().to_string(),
            "include cycle ignored",
        ));
        return;
    }

    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) => {
            diagnostics.push(Diagnostic::new(
                "config-file",
                path.display().to_string(),
                format!("could not read: {err}"),
            ));
            return;
        }
    };

    let mut includes = Vec::new();
    for directive in parse(&content) {
        if directive.key == "config-file" {
            includes.push(directive.value);
        } else {
            out.push(directive);
        }
    }

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    for include in includes {
        let (optional, raw) = match include.strip_prefix('?') {
            Some(rest) => (true, rest.trim()),
            None => (false, include.as_str()),
        };
        let include_path = resolve_path(parent, raw);
        if include_path.exists() {
            expand_file(&include_path, out, diagnostics, visited);
        } else if !optional {
            diagnostics.push(Diagnostic::new(
                "config-file",
                raw,
                "included file not found",
            ));
        }
    }
}

/// Resolve and parse the theme file for a `theme = …` value (`name`, an absolute
/// path, or the `light:…,dark:…` dual form), stripping the keys a theme file may
/// not set.
fn load_theme(
    value: &str,
    options: &LoadOptions,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<Vec<Directive>> {
    let Some(name) = pick_theme_name(value, options.appearance) else {
        diagnostics.push(Diagnostic::new(
            "theme",
            value,
            "no theme given for the current appearance",
        ));
        return None;
    };

    let Some(path) = resolve_theme_path(&name, &options.theme_dirs) else {
        diagnostics.push(Diagnostic::new("theme", &name, "theme file not found"));
        return None;
    };

    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) => {
            diagnostics.push(Diagnostic::new(
                "theme",
                path.display().to_string(),
                format!("could not read: {err}"),
            ));
            return None;
        }
    };

    // A theme file is a config fragment but may not set `theme` or `config-file`.
    Some(
        parse(&content)
            .into_iter()
            .filter(|directive| directive.key != "theme" && directive.key != "config-file")
            .collect(),
    )
}

/// Pick the theme name for the current appearance. A `light:…,dark:…` value
/// yields the matching side (or `None` if the current side is absent); any other
/// value is a plain name or path.
fn pick_theme_name(value: &str, appearance: Appearance) -> Option<String> {
    if !is_light_dark_form(value) {
        return Some(value.trim().to_string());
    }
    let wanted = match appearance {
        Appearance::Light => "light",
        Appearance::Dark => "dark",
    };
    value.split(',').find_map(|part| {
        let (side, name) = part.split_once(':')?;
        (side.trim() == wanted).then(|| name.trim().to_string())
    })
}

/// Whether `value` uses the `light:…,dark:…` dual form. Detected by a
/// `light:`/`dark:` token rather than a bare `:`, which a name or path may carry.
fn is_light_dark_form(value: &str) -> bool {
    value.split(',').any(|part| {
        let part = part.trim();
        part.starts_with("light:") || part.starts_with("dark:")
    })
}

/// An absolute theme path is used as-is (if it exists); a bare name is searched
/// across `theme_dirs` in order.
fn resolve_theme_path(name: &str, theme_dirs: &[PathBuf]) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.is_absolute() {
        return candidate.exists().then(|| candidate.to_path_buf());
    }
    theme_dirs
        .iter()
        .map(|dir| dir.join(name))
        .find(|path| path.exists())
}

fn resolve_path(parent: &Path, raw: &str) -> PathBuf {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        parent.join(candidate)
    }
}

fn last_value(directives: &[Directive], key: &str) -> Option<String> {
    directives
        .iter()
        .rev()
        .find(|directive| directive.key == key)
        .map(|directive| directive.value.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::{Color, Rgb};
    use std::fs::write;
    use tempfile::tempdir;

    fn rgb(hex: &str) -> Color {
        Color::Rgb(Rgb::from_hex(hex).expect("valid hex in test"))
    }

    fn options(config_files: Vec<PathBuf>, theme_dirs: Vec<PathBuf>) -> LoadOptions {
        LoadOptions {
            config_files,
            theme_dirs,
            appearance: Appearance::Dark,
        }
    }

    #[test]
    fn loads_a_single_config_file() {
        let dir = tempdir().expect("tempdir");
        let config = dir.path().join("config");
        write(&config, "font-size = 15\nbackground = #101010").expect("write");

        let resolved = load(&options(vec![config], vec![]));
        assert_eq!(resolved.font_size, Some(15.0));
        assert_eq!(resolved.background, Some(rgb("#101010")));
    }

    #[test]
    fn later_config_file_overrides_earlier() {
        let dir = tempdir().expect("tempdir");
        let first = dir.path().join("config");
        let second = dir.path().join("config.ghostty");
        write(&first, "background = #111111").expect("write");
        write(&second, "background = #222222").expect("write");

        let resolved = load(&options(vec![first, second], vec![]));
        assert_eq!(resolved.background, Some(rgb("#222222")));
    }

    #[test]
    fn include_is_appended_at_eof_and_overrides_later_keys() {
        let dir = tempdir().expect("tempdir");
        let main = dir.path().join("config");
        let sub = dir.path().join("sub.conf");
        // The include sits BEFORE a later `background`, yet must still win.
        write(
            &main,
            "background = #111111\nconfig-file = sub.conf\nbackground = #222222",
        )
        .expect("write");
        write(&sub, "background = #333333").expect("write");

        let resolved = load(&options(vec![main], vec![]));
        assert_eq!(resolved.background, Some(rgb("#333333")));
    }

    #[test]
    fn optional_missing_include_is_silent_but_required_one_diagnoses() {
        let dir = tempdir().expect("tempdir");
        let optional = dir.path().join("config");
        write(&optional, "config-file = ?nope.conf").expect("write");
        assert!(load(&options(vec![optional], vec![]))
            .diagnostics
            .is_empty());

        let required = dir.path().join("config2");
        write(&required, "config-file = missing.conf").expect("write");
        let resolved = load(&options(vec![required], vec![]));
        assert!(resolved.diagnostics.iter().any(|d| d.key == "config-file"));
    }

    #[test]
    fn shared_fragment_across_base_files_is_loaded_once() {
        let dir = tempdir().expect("tempdir");
        let frag = dir.path().join("frag.conf");
        write(&frag, "font-family = Shared").expect("write");
        let a = dir.path().join("config");
        let b = dir.path().join("config.ghostty");
        write(&a, "config-file = frag.conf").expect("write");
        write(&b, "config-file = frag.conf").expect("write");

        // The shared fragment is parsed once globally, so the accumulating
        // font-family fallback list is not double-counted.
        let resolved = load(&options(vec![a, b], vec![]));
        assert_eq!(resolved.font_family, vec!["Shared"]);
    }

    #[test]
    fn include_cycle_is_broken_with_a_diagnostic() {
        let dir = tempdir().expect("tempdir");
        let a = dir.path().join("a.conf");
        let b = dir.path().join("b.conf");
        write(&a, "config-file = b.conf").expect("write");
        write(&b, "config-file = a.conf\nfont-size = 9").expect("write");

        let resolved = load(&options(vec![a], vec![]));
        // No infinite recursion; the cycle is reported and the rest still loads.
        assert_eq!(resolved.font_size, Some(9.0));
        assert!(resolved
            .diagnostics
            .iter()
            .any(|d| d.message.contains("cycle")));
    }

    #[test]
    fn resolves_named_theme_as_base_layer_overridden_by_user() {
        let dir = tempdir().expect("tempdir");
        let themes = dir.path().join("themes");
        std::fs::create_dir(&themes).expect("mkdir");
        write(
            themes.join("Catppuccin"),
            "background = #1e1e2e\nforeground = #cdd6f4",
        )
        .expect("write theme");
        let config = dir.path().join("config");
        // User sets the theme AND overrides its background.
        write(&config, "theme = Catppuccin\nbackground = #000000").expect("write");

        let resolved = load(&options(vec![config], vec![themes]));
        assert_eq!(resolved.background, Some(rgb("#000000"))); // user wins
        assert_eq!(resolved.foreground, Some(rgb("#cdd6f4"))); // theme provides
    }

    #[test]
    fn picks_dark_side_of_light_dark_theme() {
        let dir = tempdir().expect("tempdir");
        let themes = dir.path().join("themes");
        std::fs::create_dir(&themes).expect("mkdir");
        write(themes.join("Day"), "background = #ffffff").expect("write");
        write(themes.join("Night"), "background = #000000").expect("write");
        let config = dir.path().join("config");
        write(&config, "theme = light:Day,dark:Night").expect("write");

        let mut opts = options(vec![config], vec![themes]);
        opts.appearance = Appearance::Dark;
        assert_eq!(load(&opts).background, Some(rgb("#000000")));
        opts.appearance = Appearance::Light;
        assert_eq!(load(&opts).background, Some(rgb("#ffffff")));
    }

    #[test]
    fn theme_file_cannot_set_theme_or_config_file() {
        let dir = tempdir().expect("tempdir");
        let themes = dir.path().join("themes");
        std::fs::create_dir(&themes).expect("mkdir");
        // A malicious/odd theme file trying to recurse or chain — both stripped.
        write(
            themes.join("Evil"),
            "theme = Other\nconfig-file = x\nbackground = #abcdef",
        )
        .expect("write");
        let config = dir.path().join("config");
        write(&config, "theme = Evil").expect("write");

        let resolved = load(&options(vec![config], vec![themes]));
        assert_eq!(resolved.background, Some(rgb("#abcdef")));
        // No "theme file not found" for "Other" and no include diagnostics.
        assert!(resolved.diagnostics.is_empty());
    }

    #[test]
    fn missing_theme_file_diagnoses() {
        let dir = tempdir().expect("tempdir");
        let config = dir.path().join("config");
        write(&config, "theme = DoesNotExist").expect("write");

        let resolved = load(&options(vec![config], vec![dir.path().join("themes")]));
        assert!(resolved.diagnostics.iter().any(|d| d.key == "theme"));
    }

    #[test]
    fn missing_config_files_yield_defaults_without_diagnostics() {
        let dir = tempdir().expect("tempdir");
        let resolved = load(&options(vec![dir.path().join("absent")], vec![]));
        assert_eq!(resolved, ResolvedConfig::default());
    }
}
