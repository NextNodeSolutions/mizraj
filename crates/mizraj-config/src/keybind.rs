//! Ghostty `keybind` directive: trigger grammar and typed actions.
//!
//! Grammar (mirroring Ghostty's `input/Binding.zig`):
//!
//! ```text
//! keybind = [flag:]*trigger=action
//! trigger = chord ('>' chord)*            -- '>' chains a leader sequence
//! chord   = (mod '+')* key                -- mods: shift|ctrl|alt|super (+aliases)
//! key     = named | unicode char | 'physical:' name
//! action  = name [':' param]
//! ```
//!
//! Flags: `global:`, `all:`, `unconsumed:`, `performable:` (combinable). The
//! special value `clear` wipes every binding accumulated so far.
//!
//! Actions inside the parity scope parse into typed variants; recognized
//! syntax with an out-of-scope action (e.g. `new_window`) parses into
//! [`KeybindAction::Unsupported`] so the dispatch can skip it without
//! generating diagnostic noise for legitimate Ghostty configs.

/// One key with its modifiers, pressed at once.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct KeyChord {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub super_key: bool,
    pub key: KeySpec,
}

/// How the key half of a chord matches: by translated character/name (layout
/// dependent) or by physical position (`physical:` prefix, layout independent).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum KeySpec {
    Logical(String),
    Physical(String),
}

/// Trigger-level flags, all combinable (`global:unconsumed:ctrl+a=…`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct KeybindFlags {
    pub global: bool,
    pub all: bool,
    pub unconsumed: bool,
    pub performable: bool,
}

/// The action half of a binding, typed for the parity scope (TP8).
#[derive(Debug, Clone, PartialEq)]
pub enum KeybindAction {
    CopyToClipboard,
    PasteFromClipboard,
    PasteFromSelection,
    SelectAll,
    IncreaseFontSize(f32),
    DecreaseFontSize(f32),
    ResetFontSize,
    ClearScreen,
    Reset,
    /// Send a literal string (Zig string-literal escapes processed).
    Text(String),
    /// Send ESC followed by the raw payload.
    Esc(String),
    /// Consume the key and do nothing (disables a default binding).
    Ignore,
    /// Remove the binding for this trigger.
    Unbind,
    /// Valid syntax, action outside the parity scope — carried verbatim so the
    /// dispatch can skip it silently.
    Unsupported(String),
}

/// One resolved `keybind` directive.
#[derive(Debug, Clone, PartialEq)]
pub struct Keybind {
    /// One chord, or several for a leader sequence (`ctrl+a>n`).
    pub trigger: Vec<KeyChord>,
    pub flags: KeybindFlags,
    pub action: KeybindAction,
}

/// What a `keybind = …` value means for the fold.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KeybindDirective {
    /// `keybind = clear`: wipe everything accumulated so far.
    Clear,
    Bind(Keybind),
}

pub(crate) fn parse_keybind(value: &str) -> Result<KeybindDirective, &'static str> {
    if value == "clear" {
        return Ok(KeybindDirective::Clear);
    }

    let (trigger_part, action_part) = value
        .split_once('=')
        .ok_or("expected trigger=action")?;

    let (flags, trigger_part) = strip_flags(trigger_part.trim());
    let trigger = parse_trigger(trigger_part)?;
    let action = parse_action(action_part.trim())?;

    Ok(KeybindDirective::Bind(Keybind {
        trigger,
        flags,
        action,
    }))
}

fn strip_flags(mut trigger: &str) -> (KeybindFlags, &str) {
    let mut flags = KeybindFlags::default();
    loop {
        let Some((head, rest)) = trigger.split_once(':') else {
            return (flags, trigger);
        };
        match head {
            "global" => flags.global = true,
            "all" => flags.all = true,
            "unconsumed" => flags.unconsumed = true,
            "performable" => flags.performable = true,
            _ => return (flags, trigger),
        }
        trigger = rest;
    }
}

fn parse_trigger(trigger: &str) -> Result<Vec<KeyChord>, &'static str> {
    if trigger.is_empty() {
        return Err("empty trigger");
    }
    trigger.split('>').map(parse_chord).collect()
}

fn parse_chord(chord: &str) -> Result<KeyChord, &'static str> {
    let chord = chord.trim();
    // `++` ends a chord whose key is the literal plus sign (`ctrl++`); a lone
    // trailing '+' is a separator with no key behind it, i.e. an error.
    let (mods_part, key_part) = if chord == "+" {
        ("", "+")
    } else if let Some(mods) = chord.strip_suffix("++") {
        (mods, "+")
    } else {
        match chord.rsplit_once('+') {
            Some((_, "")) => return Err("empty key"),
            Some((mods, key)) => (mods, key),
            None => ("", chord),
        }
    };

    let mut parsed = KeyChord {
        shift: false,
        ctrl: false,
        alt: false,
        super_key: false,
        key: parse_key(key_part.trim())?,
    };

    for raw in mods_part.split('+') {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        match raw {
            "shift" => parsed.shift = true,
            "ctrl" | "control" => parsed.ctrl = true,
            "alt" | "opt" | "option" => parsed.alt = true,
            "super" | "cmd" | "command" => parsed.super_key = true,
            _ => return Err("unknown modifier"),
        }
    }

    Ok(parsed)
}

fn parse_key(key: &str) -> Result<KeySpec, &'static str> {
    if let Some(physical) = key.strip_prefix("physical:") {
        if physical.is_empty() {
            return Err("empty physical key");
        }
        return Ok(KeySpec::Physical(physical.to_lowercase()));
    }
    if key.is_empty() {
        return Err("empty key");
    }
    Ok(KeySpec::Logical(key.to_lowercase()))
}

/// Font-size steps default to 1 point when the action carries no amount.
const DEFAULT_FONT_SIZE_STEP: f32 = 1.0;

fn parse_action(action: &str) -> Result<KeybindAction, &'static str> {
    if action.is_empty() {
        return Err("empty action");
    }
    let (name, param) = match action.split_once(':') {
        Some((name, param)) => (name, Some(param)),
        None => (action, None),
    };

    let parsed = match name {
        "copy_to_clipboard" => KeybindAction::CopyToClipboard,
        "paste_from_clipboard" => KeybindAction::PasteFromClipboard,
        "paste_from_selection" => KeybindAction::PasteFromSelection,
        "select_all" => KeybindAction::SelectAll,
        "increase_font_size" => KeybindAction::IncreaseFontSize(font_step(param)?),
        "decrease_font_size" => KeybindAction::DecreaseFontSize(font_step(param)?),
        "reset_font_size" => KeybindAction::ResetFontSize,
        "clear_screen" => KeybindAction::ClearScreen,
        "reset" => KeybindAction::Reset,
        "text" => KeybindAction::Text(unescape_text(param.ok_or("text: requires a payload")?)?),
        "esc" => KeybindAction::Esc(param.ok_or("esc: requires a payload")?.to_string()),
        "ignore" => KeybindAction::Ignore,
        "unbind" => KeybindAction::Unbind,
        _ => return Ok(KeybindAction::Unsupported(action.to_string())),
    };

    // Typed no-param actions must not silently swallow a payload (a typo like
    // `copy_to_clipboard:x` is better surfaced than ignored).
    if param.is_some() && !accepts_param(name) {
        return Err("action takes no parameter");
    }

    Ok(parsed)
}

fn accepts_param(name: &str) -> bool {
    matches!(
        name,
        "increase_font_size" | "decrease_font_size" | "text" | "esc"
    )
}

fn font_step(param: Option<&str>) -> Result<f32, &'static str> {
    match param {
        None => Ok(DEFAULT_FONT_SIZE_STEP),
        Some(raw) => raw
            .trim()
            .parse()
            .map_err(|_| "font size step must be a number"),
    }
}

/// Process Zig string-literal escapes, the syntax Ghostty documents for
/// `text:` payloads: `\n \r \t \\ \' \" \xNN \u{NNNN}`.
fn unescape_text(raw: &str) -> Result<String, &'static str> {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some('\'') => out.push('\''),
            Some('"') => out.push('"'),
            Some('x') => out.push(parse_hex_escape(&mut chars)?),
            Some('u') => out.push(parse_unicode_escape(&mut chars)?),
            _ => return Err("unknown escape in text: payload"),
        }
    }
    Ok(out)
}

fn parse_hex_escape(chars: &mut std::str::Chars) -> Result<char, &'static str> {
    let high = chars.next().ok_or("truncated \\x escape")?;
    let low = chars.next().ok_or("truncated \\x escape")?;
    let byte = u8::from_str_radix(&format!("{high}{low}"), 16)
        .map_err(|_| "invalid \\x escape")?;
    Ok(byte as char)
}

fn parse_unicode_escape(chars: &mut std::str::Chars) -> Result<char, &'static str> {
    if chars.next() != Some('{') {
        return Err("expected { after \\u");
    }
    let mut digits = String::new();
    for ch in chars.by_ref() {
        if ch == '}' {
            let code = u32::from_str_radix(&digits, 16).map_err(|_| "invalid \\u escape")?;
            return char::from_u32(code).ok_or("\\u escape is not a valid codepoint");
        }
        digits.push(ch);
    }
    Err("unterminated \\u escape")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind(value: &str) -> Keybind {
        match parse_keybind(value).expect("keybind should parse") {
            KeybindDirective::Bind(keybind) => keybind,
            KeybindDirective::Clear => panic!("expected a binding, got clear"),
        }
    }

    fn logical_chord(key: &str) -> KeyChord {
        KeyChord {
            shift: false,
            ctrl: false,
            alt: false,
            super_key: false,
            key: KeySpec::Logical(key.to_string()),
        }
    }

    #[test]
    fn parses_a_simple_super_binding() {
        let keybind = bind("super+c=copy_to_clipboard");
        assert_eq!(
            keybind.trigger,
            vec![KeyChord {
                super_key: true,
                ..logical_chord("c")
            }]
        );
        assert_eq!(keybind.action, KeybindAction::CopyToClipboard);
        assert_eq!(keybind.flags, KeybindFlags::default());
    }

    #[test]
    fn modifier_aliases_map_to_canonical_mods() {
        let keybind = bind("cmd+control+option+shift+v=paste_from_clipboard");
        let chord = &keybind.trigger[0];
        assert!(chord.super_key && chord.ctrl && chord.alt && chord.shift);
        assert_eq!(chord.key, KeySpec::Logical("v".to_string()));
    }

    #[test]
    fn physical_prefix_matches_by_position() {
        let keybind = bind("ctrl+physical:a=select_all");
        assert_eq!(
            keybind.trigger[0].key,
            KeySpec::Physical("a".to_string())
        );
    }

    #[test]
    fn a_sequence_chains_chords_with_gt() {
        let keybind = bind("ctrl+a>n=text:next");
        assert_eq!(keybind.trigger.len(), 2);
        assert!(keybind.trigger[0].ctrl);
        assert_eq!(keybind.trigger[0].key, KeySpec::Logical("a".to_string()));
        assert_eq!(keybind.trigger[1], logical_chord("n"));
    }

    #[test]
    fn flags_stack_in_front_of_the_trigger() {
        let keybind = bind("global:unconsumed:performable:all:super+k=clear_screen");
        assert_eq!(
            keybind.flags,
            KeybindFlags {
                global: true,
                all: true,
                unconsumed: true,
                performable: true,
            }
        );
    }

    #[test]
    fn font_size_actions_default_their_step_to_one() {
        assert_eq!(
            bind("super+plus=increase_font_size").action,
            KeybindAction::IncreaseFontSize(1.0)
        );
        assert_eq!(
            bind("super+minus=decrease_font_size:2.5").action,
            KeybindAction::DecreaseFontSize(2.5)
        );
        assert_eq!(
            bind("super+zero=reset_font_size").action,
            KeybindAction::ResetFontSize
        );
    }

    #[test]
    fn text_action_processes_zig_escapes() {
        assert_eq!(
            bind(r"ctrl+t=text:line\nnext\ttab \x41 \u{1F600}").action,
            KeybindAction::Text("line\nnext\ttab A 😀".to_string())
        );
    }

    #[test]
    fn esc_action_keeps_its_payload_raw() {
        assert_eq!(
            bind(r"alt+b=esc:b").action,
            KeybindAction::Esc("b".to_string())
        );
    }

    #[test]
    fn plus_key_binds_literally() {
        let keybind = bind("ctrl++=increase_font_size");
        assert_eq!(keybind.trigger[0].key, KeySpec::Logical("+".to_string()));
        assert!(keybind.trigger[0].ctrl);
    }

    #[test]
    fn clear_wipes_everything() {
        assert_eq!(
            parse_keybind("clear").expect("clear parses"),
            KeybindDirective::Clear
        );
    }

    #[test]
    fn out_of_scope_actions_parse_as_unsupported() {
        assert_eq!(
            bind("super+n=new_window").action,
            KeybindAction::Unsupported("new_window".to_string())
        );
        // The original param rides along verbatim.
        assert_eq!(
            bind("super+g=goto_tab:3").action,
            KeybindAction::Unsupported("goto_tab:3".to_string())
        );
    }

    #[test]
    fn malformed_directives_error_instead_of_panicking() {
        assert!(parse_keybind("just-a-key").is_err());
        assert!(parse_keybind("badmod+c=copy_to_clipboard").is_err());
        assert!(parse_keybind("=copy_to_clipboard").is_err());
        assert!(parse_keybind("ctrl+=copy_to_clipboard").is_err());
        assert!(parse_keybind("ctrl+c=").is_err());
        assert!(parse_keybind("ctrl+c=copy_to_clipboard:x").is_err());
        assert!(parse_keybind(r"ctrl+c=text:\q").is_err());
        assert!(parse_keybind("ctrl+physical:=select_all").is_err());
    }
}
