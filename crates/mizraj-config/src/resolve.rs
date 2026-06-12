//! Fold an ordered [`Directive`] list into the effective [`ResolvedConfig`].
//!
//! This is where Ghostty's per-key semantics live (the parser is deliberately
//! dumb): scalar keys are last-writer-wins, list keys (`font-family`,
//! `font-feature`) and the `palette` map accumulate, and an empty value resets
//! the key to its default. Callers prepend a resolved theme's directives as a
//! base layer so explicit user keys override it for free (just later in order).
//!
//! Unparseable values are recorded in [`ResolvedConfig::diagnostics`] rather than
//! silently dropped, and keys outside the current parity scope are ignored.

use std::collections::BTreeMap;

use crate::color::{parse_color, parse_plain_color, Color, Rgb};
use crate::diagnostic::Diagnostic;
use crate::keybind::{default_keybinds, parse_keybind, Keybind, KeybindAction, KeybindDirective};
use crate::value::{
    parse_bool, parse_f32, parse_u64, Adjustment, CopyOnSelect, CursorStyle, OptionAsAlt,
    PaddingAxis,
};
use crate::Directive;

/// The effective Ghostty config after folding all directives (and any theme
/// base layer). Every field is the value the renderer/keybind layers consume;
/// `None`/empty means "use the engine default" — resolution of those defaults
/// (and of the full 256-color palette) happens in the backend where libghostty
/// is available.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedConfig {
    pub font_family: Vec<String>,
    pub font_family_bold: Vec<String>,
    pub font_family_italic: Vec<String>,
    pub font_family_bold_italic: Vec<String>,
    pub font_size: Option<f32>,
    pub font_features: Vec<String>,
    pub adjust_cell_width: Option<Adjustment>,
    pub adjust_cell_height: Option<Adjustment>,
    pub adjust_underline_position: Option<Adjustment>,
    pub adjust_underline_thickness: Option<Adjustment>,
    pub adjust_strikethrough_position: Option<Adjustment>,
    pub adjust_strikethrough_thickness: Option<Adjustment>,
    pub adjust_cursor_thickness: Option<Adjustment>,
    pub background: Option<Color>,
    pub foreground: Option<Color>,
    pub cursor_color: Option<Color>,
    pub cursor_text: Option<Color>,
    pub selection_background: Option<Color>,
    pub selection_foreground: Option<Color>,
    /// Per-index palette overrides (0..=255). Indices left unset fall back to the
    /// engine default palette downstream.
    pub palette: BTreeMap<u8, Rgb>,
    pub bold_is_bright: Option<bool>,
    pub background_opacity: Option<f32>,
    pub cursor_style: Option<CursorStyle>,
    pub cursor_style_blink: Option<bool>,
    pub cursor_opacity: Option<f32>,
    /// Scrollback retention, in bytes (Ghostty measures this in bytes, not rows).
    pub scrollback_limit: Option<u64>,
    pub window_padding_x: Option<PaddingAxis>,
    pub window_padding_y: Option<PaddingAxis>,
    pub window_padding_balance: Option<bool>,
    pub copy_on_select: Option<CopyOnSelect>,
    pub mouse_hide_while_typing: Option<bool>,
    /// Which Option key acts as Alt on macOS; `None` = the macOS default
    /// (Option composes layout characters, never ESC-prefixes).
    pub macos_option_as_alt: Option<OptionAsAlt>,
    pub term: Option<String>,
    /// The effective keybinding table, in declaration order. Rebinding a
    /// trigger replaces in place, `unbind` removes, `clear` wipes, and an
    /// empty value resets to the built-in defaults — so this is the
    /// post-fold table the dispatch consumes.
    pub keybinds: Vec<Keybind>,
    /// Problems found while loading/folding the config, kept so the host can
    /// surface them rather than silently dropping bad values.
    pub diagnostics: Vec<Diagnostic>,
}

/// Fold directives into the effective config, in load order (last writer wins).
/// The keybind table starts from Ghostty's built-in defaults, so user
/// directives override/unbind/clear them exactly like in Ghostty.
pub fn resolve(directives: &[Directive]) -> ResolvedConfig {
    let mut config = ResolvedConfig {
        keybinds: default_keybinds(),
        ..ResolvedConfig::default()
    };
    for directive in directives {
        apply(&mut config, directive);
    }
    config
}

fn apply(config: &mut ResolvedConfig, directive: &Directive) {
    let value = directive.value.as_str();
    let reset = directive.is_reset();

    // Every scalar directive folds the same way: clear on reset, else parse
    // `value` into one field and record a diagnostic on a bad value. Only the
    // target field and parser differ — the diagnostic key is always the matched
    // key — so a local macro keeps each arm to those two moving parts instead of
    // a six-line `set(...)` call.
    macro_rules! scalar {
        ($field:ident, $parse:expr) => {
            set(
                &mut config.$field,
                value,
                reset,
                $parse,
                &mut config.diagnostics,
                directive.key.as_str(),
            )
        };
    }

    match directive.key.as_str() {
        "font-family" => set_list(&mut config.font_family, value, reset),
        "font-family-bold" => set_list(&mut config.font_family_bold, value, reset),
        "font-family-italic" => set_list(&mut config.font_family_italic, value, reset),
        "font-family-bold-italic" => set_list(&mut config.font_family_bold_italic, value, reset),
        "font-feature" => set_list(&mut config.font_features, value, reset),
        "font-size" => scalar!(font_size, parse_f32),
        "adjust-cell-width" => scalar!(adjust_cell_width, Adjustment::parse),
        "adjust-cell-height" => scalar!(adjust_cell_height, Adjustment::parse),
        "adjust-underline-position" => scalar!(adjust_underline_position, Adjustment::parse),
        "adjust-underline-thickness" => scalar!(adjust_underline_thickness, Adjustment::parse),
        "adjust-strikethrough-position" => {
            scalar!(adjust_strikethrough_position, Adjustment::parse)
        }
        "adjust-strikethrough-thickness" => {
            scalar!(adjust_strikethrough_thickness, Adjustment::parse)
        }
        "adjust-cursor-thickness" => scalar!(adjust_cursor_thickness, Adjustment::parse),
        // Only the cursor keys accept the cell-relative specials (Ghostty
        // semantics); every other color key parses with `parse_plain_color`.
        "background" => scalar!(background, parse_plain_color),
        "foreground" => scalar!(foreground, parse_plain_color),
        "cursor-color" => scalar!(cursor_color, parse_color),
        "cursor-text" => scalar!(cursor_text, parse_color),
        "selection-background" => scalar!(selection_background, parse_plain_color),
        "selection-foreground" => scalar!(selection_foreground, parse_plain_color),
        "palette" => apply_palette(config, value, reset),
        "bold-is-bright" => scalar!(bold_is_bright, parse_bool),
        "background-opacity" => scalar!(background_opacity, parse_f32),
        "cursor-style" => scalar!(cursor_style, CursorStyle::parse),
        "cursor-style-blink" => scalar!(cursor_style_blink, parse_bool),
        "cursor-opacity" => scalar!(cursor_opacity, parse_f32),
        "scrollback-limit" => scalar!(scrollback_limit, parse_u64),
        "window-padding-x" => scalar!(window_padding_x, PaddingAxis::parse),
        "window-padding-y" => scalar!(window_padding_y, PaddingAxis::parse),
        "window-padding-balance" => scalar!(window_padding_balance, parse_bool),
        "copy-on-select" => scalar!(copy_on_select, CopyOnSelect::parse),
        "mouse-hide-while-typing" => scalar!(mouse_hide_while_typing, parse_bool),
        "macos-option-as-alt" => scalar!(macos_option_as_alt, OptionAsAlt::parse),
        "term" => set_string(&mut config.term, value, reset),
        "keybind" => apply_keybind(config, value, reset),
        _ => {}
    }
}

/// Fold one `keybind` directive into the table: accumulate new triggers,
/// replace a re-bound trigger in place, honor `unbind`/`clear`, and record a
/// diagnostic (never panic) for malformed directives.
fn apply_keybind(config: &mut ResolvedConfig, value: &str, reset: bool) {
    if reset {
        // `keybind =` resets to the Ghostty DEFAULTS (like every other key's
        // empty-value reset); only `keybind = clear` empties the table.
        config.keybinds = default_keybinds();
        return;
    }
    match parse_keybind(value) {
        Ok(KeybindDirective::Clear) => config.keybinds.clear(),
        Ok(KeybindDirective::Bind(keybind)) => upsert_keybind(&mut config.keybinds, keybind),
        Err(reason) => config
            .diagnostics
            .push(Diagnostic::new("keybind", value, reason)),
    }
}

fn upsert_keybind(table: &mut Vec<Keybind>, keybind: Keybind) {
    let slot = table
        .iter()
        .position(|existing| existing.trigger == keybind.trigger);

    if keybind.action == KeybindAction::Unbind {
        if let Some(index) = slot {
            table.remove(index);
        }
        return;
    }

    match slot {
        Some(index) => table[index] = keybind,
        None => table.push(keybind),
    }
}

fn set_list(list: &mut Vec<String>, value: &str, reset: bool) {
    if reset {
        list.clear();
    } else {
        list.push(value.to_string());
    }
}

fn set_string(slot: &mut Option<String>, value: &str, reset: bool) {
    *slot = if reset { None } else { Some(value.to_string()) };
}

fn set<T>(
    slot: &mut Option<T>,
    value: &str,
    reset: bool,
    parse: impl FnOnce(&str) -> Option<T>,
    diagnostics: &mut Vec<Diagnostic>,
    key: &str,
) {
    if reset {
        *slot = None;
    } else if let Some(parsed) = parse(value) {
        *slot = Some(parsed);
    } else {
        diagnostics.push(Diagnostic::new(key, value, "unrecognized or invalid value"));
    }
}

fn apply_palette(config: &mut ResolvedConfig, value: &str, reset: bool) {
    if reset {
        config.palette.clear();
        return;
    }
    let Some((index_part, color_part)) = value.split_once('=') else {
        config
            .diagnostics
            .push(Diagnostic::new("palette", value, "expected N=#RRGGBB"));
        return;
    };
    let Ok(index) = index_part.trim().parse::<u8>() else {
        config.diagnostics.push(Diagnostic::new(
            "palette",
            value,
            "palette index must be 0-255",
        ));
        return;
    };
    let color = color_part.trim();
    if color.is_empty() {
        config.palette.remove(&index); // `palette = N=` resets that one index
        return;
    }
    match Rgb::from_hex(color) {
        Some(rgb) => {
            config.palette.insert(index, rgb);
        }
        None => config
            .diagnostics
            .push(Diagnostic::new("palette", value, "invalid hex color")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keybind::KeySpec;
    use crate::parse;

    fn resolved(content: &str) -> ResolvedConfig {
        resolve(&parse(content))
    }

    #[test]
    fn last_writer_wins_for_scalars() {
        let config = resolved("font-size = 12\nfont-size = 16");
        assert_eq!(config.font_size, Some(16.0));
    }

    #[test]
    fn font_family_accumulates_into_a_fallback_list() {
        let config = resolved("font-family = MonoLisa\nfont-family = JetBrains Mono");
        assert_eq!(config.font_family, vec!["MonoLisa", "JetBrains Mono"]);
    }

    #[test]
    fn empty_value_resets_a_scalar_to_default() {
        let config = resolved("font-size = 16\nfont-size =");
        assert_eq!(config.font_size, None);
    }

    #[test]
    fn empty_value_clears_an_accumulated_list() {
        let config = resolved("font-family = A\nfont-family = B\nfont-family =\nfont-family = C");
        assert_eq!(config.font_family, vec!["C"]);
    }

    #[test]
    fn parses_colors() {
        let config = resolved("background = #1e1e2e\nforeground = cdd6f4");
        assert_eq!(
            config.background,
            Some(Color::Rgb(Rgb {
                r: 0x1e,
                g: 0x1e,
                b: 0x2e
            }))
        );
        assert_eq!(
            config.foreground,
            Some(Color::Rgb(Rgb {
                r: 0xcd,
                g: 0xd6,
                b: 0xf4
            }))
        );
    }

    #[test]
    fn cursor_keys_accept_cell_relative_specials() {
        let config = resolved("cursor-color = cell-foreground\ncursor-text = cell-background");
        assert_eq!(config.cursor_color, Some(Color::CellForeground));
        assert_eq!(config.cursor_text, Some(Color::CellBackground));
        assert!(config.diagnostics.is_empty());
    }

    #[test]
    fn non_cursor_color_keys_reject_cell_relative_specials() {
        let config =
            resolved("background = cell-foreground\nselection-foreground = cell-background");
        assert_eq!(config.background, None);
        assert_eq!(config.selection_foreground, None);
        assert_eq!(config.diagnostics.len(), 2);
        assert!(config.diagnostics.iter().any(|d| d.key == "background"));
        assert!(config
            .diagnostics
            .iter()
            .any(|d| d.key == "selection-foreground"));
    }

    #[test]
    fn accumulates_palette_overrides_by_index() {
        let config = resolved("palette = 0=#000000\npalette = 15=#ffffff");
        assert_eq!(config.palette.get(&0), Some(&Rgb { r: 0, g: 0, b: 0 }));
        assert_eq!(
            config.palette.get(&15),
            Some(&Rgb {
                r: 255,
                g: 255,
                b: 255
            })
        );
    }

    #[test]
    fn later_palette_entry_overrides_same_index() {
        let config = resolved("palette = 1=#111111\npalette = 1=#cc0000");
        assert_eq!(
            config.palette.get(&1),
            Some(&Rgb {
                r: 0xcc,
                g: 0,
                b: 0
            })
        );
    }

    #[test]
    fn bare_palette_reset_clears_all_overrides() {
        let config = resolved("palette = 0=#000000\npalette =");
        assert!(config.palette.is_empty());
    }

    #[test]
    fn indexed_palette_reset_clears_one_index() {
        let config = resolved("palette = 0=#000000\npalette = 1=#ffffff\npalette = 0=");
        assert!(config.palette.get(&0).is_none());
        assert!(config.palette.get(&1).is_some());
    }

    #[test]
    fn parses_cursor_style_and_blink() {
        let config = resolved("cursor-style = bar\ncursor-style-blink = false");
        assert_eq!(config.cursor_style, Some(CursorStyle::Bar));
        assert_eq!(config.cursor_style_blink, Some(false));
    }

    #[test]
    fn parses_adjustment_percent_and_absolute() {
        let config = resolved("adjust-cell-height = 10%\nadjust-cell-width = -2");
        assert_eq!(config.adjust_cell_height, Some(Adjustment::Percent(10.0)));
        assert_eq!(config.adjust_cell_width, Some(Adjustment::Absolute(-2.0)));
    }

    #[test]
    fn parses_window_padding_single_and_pair() {
        let config = resolved("window-padding-x = 8\nwindow-padding-y = 2,6");
        assert_eq!(
            config.window_padding_x,
            Some(PaddingAxis { start: 8, end: 8 })
        );
        assert_eq!(
            config.window_padding_y,
            Some(PaddingAxis { start: 2, end: 6 })
        );
    }

    #[test]
    fn parses_copy_on_select_variants() {
        assert_eq!(
            resolved("copy-on-select = clipboard").copy_on_select,
            Some(CopyOnSelect::Clipboard)
        );
        assert_eq!(
            resolved("copy-on-select = false").copy_on_select,
            Some(CopyOnSelect::Disabled)
        );
    }

    #[test]
    fn records_diagnostics_for_unparseable_values_without_dropping_silently() {
        // `#bad` is neither valid hex (3 digits) nor a plausible name (`#`).
        let config = resolved("font-size = huge\nbackground = #bad");
        assert_eq!(config.font_size, None);
        assert_eq!(config.background, None);
        assert_eq!(config.diagnostics.len(), 2);
        assert!(config.diagnostics.iter().any(|d| d.key == "font-size"));
        assert!(config.diagnostics.iter().any(|d| d.key == "background"));
    }

    #[test]
    fn parses_macos_option_as_alt_sides() {
        assert_eq!(
            resolved("macos-option-as-alt = left").macos_option_as_alt,
            Some(OptionAsAlt::Left)
        );
        assert_eq!(
            resolved("macos-option-as-alt = true").macos_option_as_alt,
            Some(OptionAsAlt::True)
        );
        assert_eq!(resolved("").macos_option_as_alt, None);
        assert_eq!(
            resolved("macos-option-as-alt = both").macos_option_as_alt,
            None,
            "invalid side records a diagnostic instead of guessing"
        );
    }

    #[test]
    fn ignores_out_of_scope_keys() {
        // A real Ghostty key we don't (yet) honor must not produce a diagnostic.
        let config = resolved("macos-titlebar-style = tabs");
        assert!(config.diagnostics.is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_default_keybinds_exist_without_any_directive() {
        let config = resolved("");
        let copy = config
            .keybinds
            .iter()
            .find(|bind| bind.action == KeybindAction::CopyToClipboard)
            .expect("super+c -> copy must be a default");
        assert!(copy.trigger[0].super_key);
        assert!(config
            .keybinds
            .iter()
            .any(|bind| bind.action == KeybindAction::SelectAll));
        assert!(config
            .keybinds
            .iter()
            .any(|bind| bind.action == KeybindAction::ClearScreen));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn user_keybind_overrides_the_matching_default() {
        let config = resolved("keybind = super+c=select_all");
        let supers_c: Vec<_> = config
            .keybinds
            .iter()
            .filter(|bind| {
                bind.trigger.len() == 1
                    && bind.trigger[0].super_key
                    && bind.trigger[0].key == KeySpec::Logical("c".to_string())
            })
            .collect();
        assert_eq!(supers_c.len(), 1, "rebinding must replace, not duplicate");
        assert_eq!(supers_c[0].action, KeybindAction::SelectAll);
    }

    #[test]
    fn keybind_clear_wipes_the_defaults_too() {
        let config = resolved("keybind = clear");
        assert!(config.keybinds.is_empty());
    }

    #[test]
    fn keybind_directives_accumulate_into_a_table() {
        let config = resolved(
            "keybind = clear\nkeybind = super+c=copy_to_clipboard\nkeybind = super+v=paste_from_clipboard",
        );
        assert_eq!(config.keybinds.len(), 2);
        assert_eq!(config.keybinds[0].action, KeybindAction::CopyToClipboard);
        assert_eq!(config.keybinds[1].action, KeybindAction::PasteFromClipboard);
    }

    #[test]
    fn rebinding_the_same_trigger_replaces_in_place() {
        let config = resolved(
            "keybind = clear\nkeybind = super+c=copy_to_clipboard\nkeybind = super+v=paste_from_clipboard\nkeybind = super+c=select_all",
        );
        assert_eq!(config.keybinds.len(), 2);
        // Replaced in place: original position, new action.
        assert_eq!(config.keybinds[0].action, KeybindAction::SelectAll);
    }

    #[test]
    fn unbind_removes_the_matching_trigger() {
        let config = resolved(
            "keybind = clear\nkeybind = super+c=copy_to_clipboard\nkeybind = super+c=unbind",
        );
        assert!(config.keybinds.is_empty());
        assert!(config.diagnostics.is_empty());
    }

    #[test]
    fn empty_keybind_value_resets_the_table_to_defaults() {
        // Reset restores the built-in defaults — distinct from `clear`,
        // which empties the table.
        let config = resolved("keybind = clear\nkeybind = super+x=select_all\nkeybind =");
        assert_eq!(config.keybinds, default_keybinds());
    }

    #[test]
    fn invalid_keybind_records_a_diagnostic() {
        let config = resolved("keybind = clear\nkeybind = wat+c=copy_to_clipboard");
        assert!(config.keybinds.is_empty());
        assert_eq!(config.diagnostics.len(), 1);
        assert_eq!(config.diagnostics[0].key, "keybind");
    }

    #[test]
    fn theme_base_layer_is_overridden_by_later_user_keys() {
        // Loader prepends theme directives; user keys appear later and win.
        let directives = parse("background = #303446\nbackground = #000000");
        let config = resolve(&directives);
        assert_eq!(
            config.background,
            Some(Color::Rgb(Rgb { r: 0, g: 0, b: 0 }))
        );
    }
}
