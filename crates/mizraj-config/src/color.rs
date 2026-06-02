//! Color values as they appear in a Ghostty config: `#RRGGBB` / `RRGGBB` hex,
//! named X11 colors, and the `cell-foreground` / `cell-background` runtime
//! specials (valid for `cursor-color` / `cursor-text`).
//!
//! Validated against the upstream reference (`cursor-color`, `cursor-text`,
//! theme files): hex is always 6 digits, with or without a leading `#`.

/// A 24-bit RGB color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    /// Parse a `#RRGGBB` or `RRGGBB` hex string. Returns `None` for any other
    /// shape (wrong length, non-hex digits) so the caller can record a
    /// diagnostic rather than silently substituting a wrong color.
    pub fn from_hex(value: &str) -> Option<Rgb> {
        let hex = value.strip_prefix('#').unwrap_or(value);
        if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        Some(Rgb {
            r: u8::from_str_radix(&hex[0..2], 16).ok()?,
            g: u8::from_str_radix(&hex[2..4], 16).ok()?,
            b: u8::from_str_radix(&hex[4..6], 16).ok()?,
        })
    }
}

/// A color value from the config. `Named` preserves an X11 color name verbatim;
/// resolving it to RGB lands in a dedicated later slice that embeds Ghostty's
/// color table — until then a `Named` is carried, not dropped, so the gap is
/// visible (fail loud) rather than a silent default.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Color {
    Rgb(Rgb),
    Named(String),
    CellForeground,
    CellBackground,
}

/// Parse a color value. Returns `None` for input that is neither hex, a special,
/// nor a plausible color name, so the caller records a diagnostic.
pub fn parse_color(value: &str) -> Option<Color> {
    match value {
        "cell-foreground" => Some(Color::CellForeground),
        "cell-background" => Some(Color::CellBackground),
        _ => Rgb::from_hex(value)
            .map(Color::Rgb)
            .or_else(|| is_color_name(value).then(|| Color::Named(value.to_string()))),
    }
}

/// A plausible X11 color name: non-empty and only ASCII letters/spaces. This
/// rejects obvious garbage (e.g. a malformed hex like `#12`) while accepting any
/// real name for later resolution.
fn is_color_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphabetic() || byte == b' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_with_and_without_hash() {
        let expected = Rgb {
            r: 0x28,
            g: 0x2c,
            b: 0x34,
        };
        assert_eq!(Rgb::from_hex("#282c34"), Some(expected));
        assert_eq!(Rgb::from_hex("282c34"), Some(expected));
    }

    #[test]
    fn parses_uppercase_hex() {
        assert_eq!(
            Rgb::from_hex("#FFAA00"),
            Some(Rgb {
                r: 255,
                g: 170,
                b: 0
            })
        );
    }

    #[test]
    fn rejects_malformed_hex() {
        assert_eq!(Rgb::from_hex("#12"), None); // too short
        assert_eq!(Rgb::from_hex("#2812345"), None); // too long
        assert_eq!(Rgb::from_hex("#zzdead"), None); // non-hex
    }

    #[test]
    fn parses_cell_relative_specials() {
        assert_eq!(parse_color("cell-foreground"), Some(Color::CellForeground));
        assert_eq!(parse_color("cell-background"), Some(Color::CellBackground));
    }

    #[test]
    fn parses_hex_as_rgb_color() {
        assert_eq!(
            parse_color("#c6d0f5"),
            Some(Color::Rgb(Rgb {
                r: 0xc6,
                g: 0xd0,
                b: 0xf5
            }))
        );
    }

    #[test]
    fn keeps_named_color_verbatim() {
        assert_eq!(
            parse_color("cornflower blue"),
            Some(Color::Named("cornflower blue".to_string()))
        );
    }

    #[test]
    fn rejects_uninterpretable_value() {
        assert_eq!(parse_color("#nothex"), None);
        assert_eq!(parse_color("12ab"), None); // 4 hex digits: not a color
        assert_eq!(parse_color(""), None);
    }
}
