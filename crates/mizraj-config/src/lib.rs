//! Parser and resolver for Ghostty configuration files.
//!
//! `libghostty-vt` provides the terminal engine but deliberately *not* the app
//! layer: reading `~/.config/ghostty/config`, resolving themes, and producing the
//! effective config the renderer consumes. This crate is that layer, kept free of
//! Tauri so the parsing/resolution logic can be unit-tested in isolation.

mod parse;

pub use parse::{parse, Directive};
