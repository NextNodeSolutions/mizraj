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

use crate::color::{parse_color, Color, Rgb};
use crate::Directive;

/// The shape Ghostty draws the cursor as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
    BlockHollow,
}

impl CursorStyle {
    fn parse(value: &str) -> Option<CursorStyle> {
        match value {
            "block" => Some(CursorStyle::Block),
            "bar" => Some(CursorStyle::Bar),
            "underline" => Some(CursorStyle::Underline),
            "block_hollow" => Some(CursorStyle::BlockHollow),
            _ => None,
        }
    }
}

/// What `copy-on-select` copies the selection to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyOnSelect {
    Disabled,
    /// The selection/primary target (on platforms without one, the clipboard).
    Selection,
    /// Both the selection target and the system clipboard.
    Clipboard,
}

impl CopyOnSelect {
    fn parse(value: &str) -> Option<CopyOnSelect> {
        match value {
            "false" => Some(CopyOnSelect::Disabled),
            "true" => Some(CopyOnSelect::Selection),
            "clipboard" => Some(CopyOnSelect::Clipboard),
            _ => None,
        }
    }
}

/// A Ghostty cell-metric adjustment: an absolute amount or a percentage of the
/// natural metric (`adjust-cell-height = 10%` vs `adjust-cell-height = -2`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Adjustment {
    Percent(f32),
    Absolute(f32),
}

impl Adjustment {
    fn parse(value: &str) -> Option<Adjustment> {
        match value.strip_suffix('%') {
            Some(percent) => percent.trim().parse().ok().map(Adjustment::Percent),
            None => value.parse().ok().map(Adjustment::Absolute),
        }
    }
}

/// Padding for one axis, in points. A single `N` sets both sides; `N,M` sets the
/// two sides independently (Ghostty's `window-padding-x = left,right`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaddingAxis {
    pub start: u16,
    pub end: u16,
}

impl PaddingAxis {
    fn parse(value: &str) -> Option<PaddingAxis> {
        let mut parts = value.split(',');
        let start: u16 = parts.next()?.trim().parse().ok()?;
        let end = match parts.next() {
            Some(second) => second.trim().parse().ok()?,
            None => start,
        };
        if parts.next().is_some() {
            return None;
        }
        Some(PaddingAxis { start, end })
    }
}

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
    pub term: Option<String>,
    /// Values that could not be parsed, kept so the host can surface them.
    pub diagnostics: Vec<String>,
}

/// Fold directives into the effective config, in load order (last writer wins).
pub fn resolve(directives: &[Directive]) -> ResolvedConfig {
    let mut config = ResolvedConfig::default();
    for directive in directives {
        apply(&mut config, directive);
    }
    config
}

fn apply(config: &mut ResolvedConfig, directive: &Directive) {
    let value = directive.value.as_str();
    let reset = directive.is_reset();
    match directive.key.as_str() {
        "font-family" => set_list(&mut config.font_family, value, reset),
        "font-family-bold" => set_list(&mut config.font_family_bold, value, reset),
        "font-family-italic" => set_list(&mut config.font_family_italic, value, reset),
        "font-family-bold-italic" => set_list(&mut config.font_family_bold_italic, value, reset),
        "font-feature" => set_list(&mut config.font_features, value, reset),
        "font-size" => set(
            &mut config.font_size,
            value,
            reset,
            parse_f32,
            &mut config.diagnostics,
            "font-size",
        ),
        "adjust-cell-width" => set(
            &mut config.adjust_cell_width,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-cell-width",
        ),
        "adjust-cell-height" => set(
            &mut config.adjust_cell_height,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-cell-height",
        ),
        "adjust-underline-position" => set(
            &mut config.adjust_underline_position,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-underline-position",
        ),
        "adjust-underline-thickness" => set(
            &mut config.adjust_underline_thickness,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-underline-thickness",
        ),
        "adjust-strikethrough-position" => set(
            &mut config.adjust_strikethrough_position,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-strikethrough-position",
        ),
        "adjust-strikethrough-thickness" => set(
            &mut config.adjust_strikethrough_thickness,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-strikethrough-thickness",
        ),
        "adjust-cursor-thickness" => set(
            &mut config.adjust_cursor_thickness,
            value,
            reset,
            Adjustment::parse,
            &mut config.diagnostics,
            "adjust-cursor-thickness",
        ),
        "background" => set(
            &mut config.background,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "background",
        ),
        "foreground" => set(
            &mut config.foreground,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "foreground",
        ),
        "cursor-color" => set(
            &mut config.cursor_color,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "cursor-color",
        ),
        "cursor-text" => set(
            &mut config.cursor_text,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "cursor-text",
        ),
        "selection-background" => set(
            &mut config.selection_background,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "selection-background",
        ),
        "selection-foreground" => set(
            &mut config.selection_foreground,
            value,
            reset,
            parse_color,
            &mut config.diagnostics,
            "selection-foreground",
        ),
        "palette" => apply_palette(config, value, reset),
        "bold-is-bright" => set(
            &mut config.bold_is_bright,
            value,
            reset,
            parse_bool,
            &mut config.diagnostics,
            "bold-is-bright",
        ),
        "background-opacity" => set(
            &mut config.background_opacity,
            value,
            reset,
            parse_f32,
            &mut config.diagnostics,
            "background-opacity",
        ),
        "cursor-style" => set(
            &mut config.cursor_style,
            value,
            reset,
            CursorStyle::parse,
            &mut config.diagnostics,
            "cursor-style",
        ),
        "cursor-style-blink" => set(
            &mut config.cursor_style_blink,
            value,
            reset,
            parse_bool,
            &mut config.diagnostics,
            "cursor-style-blink",
        ),
        "cursor-opacity" => set(
            &mut config.cursor_opacity,
            value,
            reset,
            parse_f32,
            &mut config.diagnostics,
            "cursor-opacity",
        ),
        "scrollback-limit" => set(
            &mut config.scrollback_limit,
            value,
            reset,
            parse_u64,
            &mut config.diagnostics,
            "scrollback-limit",
        ),
        "window-padding-x" => set(
            &mut config.window_padding_x,
            value,
            reset,
            PaddingAxis::parse,
            &mut config.diagnostics,
            "window-padding-x",
        ),
        "window-padding-y" => set(
            &mut config.window_padding_y,
            value,
            reset,
            PaddingAxis::parse,
            &mut config.diagnostics,
            "window-padding-y",
        ),
        "window-padding-balance" => set(
            &mut config.window_padding_balance,
            value,
            reset,
            parse_bool,
            &mut config.diagnostics,
            "window-padding-balance",
        ),
        "copy-on-select" => set(
            &mut config.copy_on_select,
            value,
            reset,
            CopyOnSelect::parse,
            &mut config.diagnostics,
            "copy-on-select",
        ),
        "mouse-hide-while-typing" => set(
            &mut config.mouse_hide_while_typing,
            value,
            reset,
            parse_bool,
            &mut config.diagnostics,
            "mouse-hide-while-typing",
        ),
        "term" => set_string(&mut config.term, value, reset),
        _ => {}
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
    diagnostics: &mut Vec<String>,
    key: &str,
) {
    if reset {
        *slot = None;
    } else if let Some(parsed) = parse(value) {
        *slot = Some(parsed);
    } else {
        diagnostics.push(format!("invalid value for {key}: {value:?}"));
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
            .push(format!("invalid palette entry: {value:?}"));
        return;
    };
    let Ok(index) = index_part.trim().parse::<u8>() else {
        config
            .diagnostics
            .push(format!("invalid palette index: {value:?}"));
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
            .push(format!("invalid palette color: {value:?}")),
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_f32(value: &str) -> Option<f32> {
    value.parse().ok()
}

fn parse_u64(value: &str) -> Option<u64> {
    value.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(config.diagnostics.iter().any(|d| d.contains("font-size")));
        assert!(config.diagnostics.iter().any(|d| d.contains("background")));
    }

    #[test]
    fn ignores_out_of_scope_keys() {
        // A real Ghostty key we don't (yet) honor must not produce a diagnostic.
        let config = resolved("macos-titlebar-style = tabs");
        assert!(config.diagnostics.is_empty());
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
