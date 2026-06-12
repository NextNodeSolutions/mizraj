//! Wire DTO for the Ghostty config and its mapping from the resolved config.
//!
//! This is the pure `ResolvedConfig -> serde wire shape` adapter, with no
//! platform/path knowledge — that lives in the parent `ghostty` module (the
//! host bridge: path resolution + the Tauri command).

use mizraj_config::{
    Adjustment, Color, CopyOnSelect, CursorStyle, Diagnostic, Keybind, KeybindAction,
    KeybindFlags, KeyChord, KeySpec, PaddingAxis, ResolvedConfig,
};
use serde::Serialize;

/// A cell-metric adjustment as the frontend sees it: a tagged percent/absolute.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AdjustmentDto {
    Percent { value: f32 },
    Absolute { value: f32 },
}

impl From<Adjustment> for AdjustmentDto {
    fn from(adjustment: Adjustment) -> Self {
        match adjustment {
            Adjustment::Percent(value) => AdjustmentDto::Percent { value },
            Adjustment::Absolute(value) => AdjustmentDto::Absolute { value },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct PaddingDto {
    start: u16,
    end: u16,
}

impl From<PaddingAxis> for PaddingDto {
    fn from(padding: PaddingAxis) -> Self {
        PaddingDto {
            start: padding.start,
            end: padding.end,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct PaletteEntryDto {
    index: u8,
    color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct DiagnosticDto {
    key: String,
    value: String,
    message: String,
}

impl From<Diagnostic> for DiagnosticDto {
    fn from(diagnostic: Diagnostic) -> Self {
        DiagnosticDto {
            key: diagnostic.key,
            value: diagnostic.value,
            message: diagnostic.message,
        }
    }
}

/// A trigger key, tagged by matching mode (layout-dependent character vs
/// physical position).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum KeySpecDto {
    Logical { name: String },
    Physical { name: String },
}

impl From<KeySpec> for KeySpecDto {
    fn from(key: KeySpec) -> Self {
        match key {
            KeySpec::Logical(name) => KeySpecDto::Logical { name },
            KeySpec::Physical(name) => KeySpecDto::Physical { name },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct KeyChordDto {
    shift: bool,
    ctrl: bool,
    alt: bool,
    #[serde(rename = "super")]
    super_key: bool,
    key: KeySpecDto,
}

impl From<KeyChord> for KeyChordDto {
    fn from(chord: KeyChord) -> Self {
        KeyChordDto {
            shift: chord.shift,
            ctrl: chord.ctrl,
            alt: chord.alt,
            super_key: chord.super_key,
            key: chord.key.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct KeybindFlagsDto {
    global: bool,
    all: bool,
    unconsumed: bool,
    performable: bool,
}

impl From<KeybindFlags> for KeybindFlagsDto {
    fn from(flags: KeybindFlags) -> Self {
        KeybindFlagsDto {
            global: flags.global,
            all: flags.all,
            unconsumed: flags.unconsumed,
            performable: flags.performable,
        }
    }
}

/// A keybind action in the wire shape: a tagged union the frontend dispatch
/// switches on. `unbind` never reaches the wire (consumed by the fold);
/// `unsupported` carries the raw action so the dispatch skips it knowingly.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum KeybindActionDto {
    CopyToClipboard,
    PasteFromClipboard,
    PasteFromSelection,
    SelectAll,
    IncreaseFontSize { amount: f32 },
    DecreaseFontSize { amount: f32 },
    ResetFontSize,
    ClearScreen,
    Reset,
    Text { text: String },
    Esc { sequence: String },
    Ignore,
    Unsupported { action: String },
}

/// One effective keybinding: trigger chord sequence, flags, typed action.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KeybindDto {
    trigger: Vec<KeyChordDto>,
    flags: KeybindFlagsDto,
    action: KeybindActionDto,
}

/// `None` for `Unbind` (already consumed by the fold; a defensive skip here
/// beats a panic on an impossible state).
fn keybind_dto(keybind: Keybind) -> Option<KeybindDto> {
    let action = match keybind.action {
        KeybindAction::CopyToClipboard => KeybindActionDto::CopyToClipboard,
        KeybindAction::PasteFromClipboard => KeybindActionDto::PasteFromClipboard,
        KeybindAction::PasteFromSelection => KeybindActionDto::PasteFromSelection,
        KeybindAction::SelectAll => KeybindActionDto::SelectAll,
        KeybindAction::IncreaseFontSize(amount) => KeybindActionDto::IncreaseFontSize { amount },
        KeybindAction::DecreaseFontSize(amount) => KeybindActionDto::DecreaseFontSize { amount },
        KeybindAction::ResetFontSize => KeybindActionDto::ResetFontSize,
        KeybindAction::ClearScreen => KeybindActionDto::ClearScreen,
        KeybindAction::Reset => KeybindActionDto::Reset,
        KeybindAction::Text(text) => KeybindActionDto::Text { text },
        KeybindAction::Esc(sequence) => KeybindActionDto::Esc { sequence },
        KeybindAction::Ignore => KeybindActionDto::Ignore,
        KeybindAction::Unsupported(action) => KeybindActionDto::Unsupported { action },
        KeybindAction::Unbind => return None,
    };
    Some(KeybindDto {
        trigger: keybind.trigger.into_iter().map(KeyChordDto::from).collect(),
        flags: keybind.flags.into(),
        action,
    })
}

/// The effective Ghostty config, in the wire shape the frontend renderer reads.
/// `None`/empty fields mean "use the engine default" (the renderer keeps its own
/// fallback). Colors are `#rrggbb` hex (or the `cell-foreground`/`cell-background`
/// sentinels for cursor colors).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GhosttyConfigDto {
    font_family: Vec<String>,
    font_family_bold: Vec<String>,
    font_family_italic: Vec<String>,
    font_family_bold_italic: Vec<String>,
    font_size: Option<f32>,
    font_features: Vec<String>,
    adjust_cell_width: Option<AdjustmentDto>,
    adjust_cell_height: Option<AdjustmentDto>,
    adjust_underline_position: Option<AdjustmentDto>,
    adjust_underline_thickness: Option<AdjustmentDto>,
    adjust_strikethrough_position: Option<AdjustmentDto>,
    adjust_strikethrough_thickness: Option<AdjustmentDto>,
    adjust_cursor_thickness: Option<AdjustmentDto>,
    background: Option<String>,
    foreground: Option<String>,
    cursor_color: Option<String>,
    cursor_text: Option<String>,
    selection_background: Option<String>,
    selection_foreground: Option<String>,
    palette: Vec<PaletteEntryDto>,
    bold_is_bright: Option<bool>,
    background_opacity: Option<f32>,
    cursor_style: Option<String>,
    cursor_style_blink: Option<bool>,
    cursor_opacity: Option<f32>,
    scrollback_limit: Option<u64>,
    window_padding_x: Option<PaddingDto>,
    window_padding_y: Option<PaddingDto>,
    window_padding_balance: Option<bool>,
    copy_on_select: Option<String>,
    mouse_hide_while_typing: Option<bool>,
    term: Option<String>,
    keybinds: Vec<KeybindDto>,
    diagnostics: Vec<DiagnosticDto>,
}

fn hex(color: &mizraj_config::Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)
}

/// Map a resolved color to its wire string, recording a diagnostic for a named
/// X11 color (not yet resolvable — see the parity ADR) rather than dropping it.
fn color_string(color: Color, key: &str, diagnostics: &mut Vec<DiagnosticDto>) -> Option<String> {
    match color {
        Color::Rgb(rgb) => Some(hex(&rgb)),
        Color::CellForeground => Some("cell-foreground".to_string()),
        Color::CellBackground => Some("cell-background".to_string()),
        Color::Named(name) => {
            diagnostics.push(DiagnosticDto {
                key: key.to_string(),
                value: name,
                message: "named X11 colors are not resolved yet".to_string(),
            });
            None
        }
    }
}

fn cursor_style_name(style: CursorStyle) -> &'static str {
    match style {
        CursorStyle::Block => "block",
        CursorStyle::Bar => "bar",
        CursorStyle::Underline => "underline",
        CursorStyle::BlockHollow => "block_hollow",
    }
}

fn copy_on_select_name(value: CopyOnSelect) -> &'static str {
    match value {
        CopyOnSelect::Disabled => "disabled",
        CopyOnSelect::Selection => "selection",
        CopyOnSelect::Clipboard => "clipboard",
    }
}

/// Map the resolved config onto the wire DTO, threading color diagnostics in
/// alongside the loader/resolver ones.
pub(crate) fn build_dto(config: ResolvedConfig) -> GhosttyConfigDto {
    let mut diagnostics: Vec<DiagnosticDto> = config
        .diagnostics
        .into_iter()
        .map(DiagnosticDto::from)
        .collect();

    let mut color = |color: Option<Color>, key: &str| {
        color.and_then(|color| color_string(color, key, &mut diagnostics))
    };

    let background = color(config.background, "background");
    let foreground = color(config.foreground, "foreground");
    let cursor_color = color(config.cursor_color, "cursor-color");
    let cursor_text = color(config.cursor_text, "cursor-text");
    let selection_background = color(config.selection_background, "selection-background");
    let selection_foreground = color(config.selection_foreground, "selection-foreground");

    let palette = config
        .palette
        .into_iter()
        .map(|(index, rgb)| PaletteEntryDto {
            index,
            color: hex(&rgb),
        })
        .collect();

    GhosttyConfigDto {
        font_family: config.font_family,
        font_family_bold: config.font_family_bold,
        font_family_italic: config.font_family_italic,
        font_family_bold_italic: config.font_family_bold_italic,
        font_size: config.font_size,
        font_features: config.font_features,
        adjust_cell_width: config.adjust_cell_width.map(AdjustmentDto::from),
        adjust_cell_height: config.adjust_cell_height.map(AdjustmentDto::from),
        adjust_underline_position: config.adjust_underline_position.map(AdjustmentDto::from),
        adjust_underline_thickness: config.adjust_underline_thickness.map(AdjustmentDto::from),
        adjust_strikethrough_position: config
            .adjust_strikethrough_position
            .map(AdjustmentDto::from),
        adjust_strikethrough_thickness: config
            .adjust_strikethrough_thickness
            .map(AdjustmentDto::from),
        adjust_cursor_thickness: config.adjust_cursor_thickness.map(AdjustmentDto::from),
        background,
        foreground,
        cursor_color,
        cursor_text,
        selection_background,
        selection_foreground,
        palette,
        bold_is_bright: config.bold_is_bright,
        background_opacity: config.background_opacity,
        cursor_style: config
            .cursor_style
            .map(|style| cursor_style_name(style).to_string()),
        cursor_style_blink: config.cursor_style_blink,
        cursor_opacity: config.cursor_opacity,
        scrollback_limit: config.scrollback_limit,
        window_padding_x: config.window_padding_x.map(PaddingDto::from),
        window_padding_y: config.window_padding_y.map(PaddingDto::from),
        window_padding_balance: config.window_padding_balance,
        copy_on_select: config
            .copy_on_select
            .map(|value| copy_on_select_name(value).to_string()),
        mouse_hide_while_typing: config.mouse_hide_while_typing,
        term: config.term,
        keybinds: config.keybinds.into_iter().filter_map(keybind_dto).collect(),
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mizraj_config::{parse, resolve};

    fn dto(content: &str) -> GhosttyConfigDto {
        build_dto(resolve(&parse(content)))
    }

    #[test]
    fn maps_font_and_size() {
        let dto = dto("font-family = MonoLisa\nfont-family = JetBrains Mono\nfont-size = 14");
        assert_eq!(dto.font_family, vec!["MonoLisa", "JetBrains Mono"]);
        assert_eq!(dto.font_size, Some(14.0));
    }

    #[test]
    fn maps_colors_to_hex() {
        let dto = dto("background = #1E1E2E\nforeground = cdd6f4");
        assert_eq!(dto.background.as_deref(), Some("#1e1e2e"));
        assert_eq!(dto.foreground.as_deref(), Some("#cdd6f4"));
    }

    #[test]
    fn maps_palette_entries_to_hex() {
        let dto = dto("palette = 0=#000000\npalette = 1=#cc0000");
        assert_eq!(
            dto.palette,
            vec![
                PaletteEntryDto {
                    index: 0,
                    color: "#000000".to_string()
                },
                PaletteEntryDto {
                    index: 1,
                    color: "#cc0000".to_string()
                },
            ]
        );
    }

    #[test]
    fn maps_cursor_and_padding() {
        let dto = dto("cursor-style = bar\ncursor-style-blink = false\nwindow-padding-x = 4,8");
        assert_eq!(dto.cursor_style.as_deref(), Some("bar"));
        assert_eq!(dto.cursor_style_blink, Some(false));
        assert_eq!(dto.window_padding_x, Some(PaddingDto { start: 4, end: 8 }));
    }

    #[test]
    fn maps_adjustment_as_tagged_value() {
        let dto = dto("adjust-cell-height = 10%");
        assert_eq!(
            dto.adjust_cell_height,
            Some(AdjustmentDto::Percent { value: 10.0 })
        );
    }

    #[test]
    fn named_color_becomes_a_diagnostic_not_a_silent_drop() {
        let dto = dto("background = rebeccapurple");
        assert_eq!(dto.background, None);
        assert!(dto.diagnostics.iter().any(|d| d.key == "background"));
    }

    #[test]
    fn forwards_loader_diagnostics() {
        let dto = dto("font-size = enormous");
        assert!(dto.diagnostics.iter().any(|d| d.key == "font-size"));
    }

    #[test]
    fn maps_keybinds_with_typed_actions_and_triggers() {
        let dto = dto(
            "keybind = clear\nkeybind = global:super+c=copy_to_clipboard\nkeybind = ctrl+a>n=text:next\nkeybind = super+k=new_window",
        );
        let json = serde_json::to_value(&dto).expect("serialize");

        assert_eq!(json["keybinds"][0]["flags"]["global"], true);
        assert_eq!(json["keybinds"][0]["trigger"][0]["super"], true);
        assert_eq!(
            json["keybinds"][0]["trigger"][0]["key"],
            serde_json::json!({ "kind": "logical", "name": "c" })
        );
        assert_eq!(
            json["keybinds"][0]["action"],
            serde_json::json!({ "kind": "copy_to_clipboard" })
        );

        // The sequence keeps both chords, the text payload is unescaped.
        assert_eq!(json["keybinds"][1]["trigger"].as_array().map(Vec::len), Some(2));
        assert_eq!(
            json["keybinds"][1]["action"],
            serde_json::json!({ "kind": "text", "text": "next" })
        );

        // Out-of-scope actions ride along tagged, for the dispatch to skip.
        assert_eq!(
            json["keybinds"][2]["action"],
            serde_json::json!({ "kind": "unsupported", "action": "new_window" })
        );
    }

    #[test]
    fn serializes_to_snake_case_wire_shape() {
        let dto = dto("font-size = 13\nbackground = #112233\ncursor-style = block");
        let json = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(json["font_size"], 13.0);
        assert_eq!(json["background"], "#112233");
        assert_eq!(json["cursor_style"], "block");
    }
}
