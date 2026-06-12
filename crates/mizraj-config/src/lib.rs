//! Parser and resolver for Ghostty configuration files.
//!
//! `libghostty-vt` provides the terminal engine but deliberately *not* the app
//! layer: reading `~/.config/ghostty/config`, resolving themes, and producing the
//! effective config the renderer consumes. This crate is that layer, kept free of
//! Tauri so the parsing/resolution logic can be unit-tested in isolation.

mod color;
mod diagnostic;
mod keybind;
mod load;
mod parse;
mod resolve;
mod value;

pub use color::{parse_color, Color, Rgb};
pub use diagnostic::Diagnostic;
pub use keybind::{
    KeyChord, KeySpec, Keybind, KeybindAction, KeybindFlags, SplitDirection, SplitFocus,
};
pub use load::{load, Appearance, LoadOptions};
pub use parse::{parse, Directive};
pub use resolve::{resolve, ResolvedConfig};
pub use value::{Adjustment, CopyOnSelect, CursorStyle, OptionAsAlt, PaddingAxis};
