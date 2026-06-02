//! Line parser for the Ghostty config-file syntax.
//!
//! Ghostty's format is a bespoke line-oriented `key = value` list (not INI/TOML):
//! keys may repeat (`palette`, `font-family`, `keybind`, …) and accumulate, an
//! empty value resets a key to its default, and `#` comments are honored only on
//! their own line. No off-the-shelf parser matches those semantics, so this is a
//! small deterministic hand-roll — validated against the upstream config docs
//! (<https://ghostty.org/docs/config>).

/// A single `key = value` directive, in file load order.
///
/// `value` is trimmed and unquoted. An empty `value` is Ghostty's "reset this key
/// to its default" directive (`font-family =` or `font-family = ""`); it is kept
/// here rather than dropped, because only a higher layer that knows each key's
/// default can apply that semantics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directive {
    pub key: String,
    pub value: String,
}

impl Directive {
    /// Whether this directive resets its key to the Ghostty default (empty value).
    pub fn is_reset(&self) -> bool {
        self.value.is_empty()
    }
}

const BOM: char = '\u{FEFF}';

/// Parse Ghostty config text into an ordered list of directives.
///
/// Rules (mirroring Ghostty): whitespace around `=` is ignored; `#` comments are
/// honored only on their own line (a `#` inside a value is literal); blank lines
/// are ignored; the value may be wrapped in one pair of double quotes; an empty
/// value is a reset; a line without `=` (or with an empty key) is ignored. Only
/// the first `=` splits key from value, so a value may itself contain `=`
/// (`palette = 0=#1d1f21`, `keybind = ctrl+a=new_split:right`).
pub fn parse(content: &str) -> Vec<Directive> {
    // A UTF-8 BOM only ever appears at the very start of the file, so strip it
    // once here rather than testing every line.
    strip_bom(content).lines().filter_map(parse_line).collect()
}

fn parse_line(raw_line: &str) -> Option<Directive> {
    let line = raw_line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (raw_key, raw_value) = line.split_once('=')?;
    let key = raw_key.trim();
    if key.is_empty() {
        return None;
    }
    Some(Directive {
        key: key.to_string(),
        value: unquote(raw_value.trim()).to_string(),
    })
}

/// Strip a leading UTF-8 BOM from the whole config text.
fn strip_bom(content: &str) -> &str {
    content.strip_prefix(BOM).unwrap_or(content)
}

/// Remove one pair of surrounding double quotes, if present: `"foo"` -> `foo`,
/// `""` -> `` (a reset). An unbalanced or unquoted value is returned untouched.
fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directive(key: &str, value: &str) -> Directive {
        Directive {
            key: key.to_string(),
            value: value.to_string(),
        }
    }

    #[test]
    fn parses_basic_key_value() {
        assert_eq!(parse("font-size = 14"), vec![directive("font-size", "14")]);
    }

    #[test]
    fn ignores_whitespace_around_equals() {
        assert_eq!(
            parse("theme=Catppuccin Frappe"),
            vec![directive("theme", "Catppuccin Frappe")]
        );
        assert_eq!(
            parse("theme    =    Catppuccin Frappe   "),
            vec![directive("theme", "Catppuccin Frappe")]
        );
    }

    #[test]
    fn skips_comment_lines_and_blank_lines() {
        let input = "# a comment\n\nfont-size = 14\n   \n# trailing comment\n";
        assert_eq!(parse(input), vec![directive("font-size", "14")]);
    }

    #[test]
    fn treats_hash_inside_value_as_literal() {
        // `#` is a comment only on its own line, so a color hex keeps its `#`.
        assert_eq!(
            parse("background = #282c34"),
            vec![directive("background", "#282c34")]
        );
    }

    #[test]
    fn splits_on_first_equals_only() {
        // palette / keybind values legitimately contain further `=`.
        assert_eq!(
            parse("palette = 0=#1d1f21"),
            vec![directive("palette", "0=#1d1f21")]
        );
        assert_eq!(
            parse("keybind = ctrl+a=new_split:right"),
            vec![directive("keybind", "ctrl+a=new_split:right")]
        );
    }

    #[test]
    fn empty_value_is_a_reset() {
        let parsed = parse("font-family =");
        assert_eq!(parsed, vec![directive("font-family", "")]);
        assert!(parsed[0].is_reset());
    }

    #[test]
    fn quoted_empty_value_is_a_reset() {
        let parsed = parse(r#"font-family = """#);
        assert_eq!(parsed, vec![directive("font-family", "")]);
        assert!(parsed[0].is_reset());
    }

    #[test]
    fn strips_one_pair_of_surrounding_quotes() {
        assert_eq!(
            parse(r#"font-family = "JetBrains Mono""#),
            vec![directive("font-family", "JetBrains Mono")]
        );
    }

    #[test]
    fn leaves_unbalanced_quote_untouched() {
        assert_eq!(
            parse(r#"title = "unbalanced"#),
            vec![directive("title", r#""unbalanced"#)]
        );
    }

    #[test]
    fn ignores_lines_without_equals_or_empty_key() {
        assert_eq!(parse("not a directive"), vec![]);
        assert_eq!(parse("= orphan value"), vec![]);
    }

    #[test]
    fn strips_leading_bom() {
        let input = "\u{FEFF}font-size = 14\nbackground = #000000";
        assert_eq!(
            parse(input),
            vec![
                directive("font-size", "14"),
                directive("background", "#000000"),
            ]
        );
    }

    #[test]
    fn handles_crlf_line_endings() {
        assert_eq!(
            parse("font-size = 14\r\ntheme = Nord\r\n"),
            vec![directive("font-size", "14"), directive("theme", "Nord")]
        );
    }

    #[test]
    fn preserves_repeated_keys_in_load_order() {
        let input = "palette = 0=#000000\npalette = 1=#cc0000\nfont-family = A\nfont-family = B";
        assert_eq!(
            parse(input),
            vec![
                directive("palette", "0=#000000"),
                directive("palette", "1=#cc0000"),
                directive("font-family", "A"),
                directive("font-family", "B"),
            ]
        );
    }
}
