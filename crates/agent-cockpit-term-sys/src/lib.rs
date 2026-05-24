//! Raw FFI bindings to libghostty-vt.
//!
//! This `-sys` crate confines every `unsafe` block and every `extern "C"`
//! declaration touching libghostty. Higher-level crates (notably
//! `agent-cockpit-term`) wrap this surface into a safe API and must not
//! contain any `unsafe` of their own. See `README.md` for the rule.
//!
//! The contents below are generated at build time by `bindgen` from the
//! vendored C headers under `vendor/include/ghostty/`. Override the header
//! root via the `LIBGHOSTTY_INCLUDE_DIR` env var (see `build.rs`).

#![allow(non_upper_case_globals, non_camel_case_types, non_snake_case)]
#![allow(dead_code, deref_nullptr, clippy::all)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
