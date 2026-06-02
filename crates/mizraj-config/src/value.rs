//! Typed config values and their scalar parsers.
//!
//! These are the value-objects a directive's right-hand side can resolve to —
//! independent of how the fold ([`crate::resolve`]) assembles them. Kept in
//! their own module (like [`crate::color`]) so the fold stays focused on
//! last-writer/accumulate/reset semantics rather than per-value parsing.

/// The shape Ghostty draws the cursor as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
    BlockHollow,
}

impl CursorStyle {
    pub(crate) fn parse(value: &str) -> Option<CursorStyle> {
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
    pub(crate) fn parse(value: &str) -> Option<CopyOnSelect> {
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
    pub(crate) fn parse(value: &str) -> Option<Adjustment> {
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
    pub(crate) fn parse(value: &str) -> Option<PaddingAxis> {
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

pub(crate) fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

pub(crate) fn parse_f32(value: &str) -> Option<f32> {
    value.parse().ok()
}

pub(crate) fn parse_u64(value: &str) -> Option<u64> {
    value.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_style_parses_known_shapes_only() {
        assert_eq!(CursorStyle::parse("bar"), Some(CursorStyle::Bar));
        assert_eq!(
            CursorStyle::parse("block_hollow"),
            Some(CursorStyle::BlockHollow)
        );
        assert_eq!(CursorStyle::parse("beam"), None);
    }

    #[test]
    fn copy_on_select_maps_true_false_clipboard() {
        assert_eq!(CopyOnSelect::parse("true"), Some(CopyOnSelect::Selection));
        assert_eq!(CopyOnSelect::parse("false"), Some(CopyOnSelect::Disabled));
        assert_eq!(
            CopyOnSelect::parse("clipboard"),
            Some(CopyOnSelect::Clipboard)
        );
        assert_eq!(CopyOnSelect::parse("yes"), None);
    }

    #[test]
    fn adjustment_distinguishes_percent_from_absolute() {
        assert_eq!(Adjustment::parse("10%"), Some(Adjustment::Percent(10.0)));
        assert_eq!(Adjustment::parse("-2"), Some(Adjustment::Absolute(-2.0)));
        assert_eq!(Adjustment::parse("huge"), None);
    }

    #[test]
    fn padding_axis_accepts_single_and_pair() {
        assert_eq!(
            PaddingAxis::parse("8"),
            Some(PaddingAxis { start: 8, end: 8 })
        );
        assert_eq!(
            PaddingAxis::parse("2,6"),
            Some(PaddingAxis { start: 2, end: 6 })
        );
        assert_eq!(PaddingAxis::parse("1,2,3"), None);
        assert_eq!(PaddingAxis::parse("x"), None);
    }

    #[test]
    fn scalar_parsers_round_trip() {
        assert_eq!(parse_bool("true"), Some(true));
        assert_eq!(parse_bool("maybe"), None);
        assert_eq!(parse_f32("13.5"), Some(13.5));
        assert_eq!(parse_u64("10000"), Some(10_000));
        assert_eq!(parse_u64("-1"), None);
    }
}
