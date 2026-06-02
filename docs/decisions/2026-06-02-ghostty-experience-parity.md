# ADR — Ghostty experience parity on the embedded terminal

- **Date**: 2026-06-02
- **Branch**: `feat/ghostty`
- **Builds on**: `2026-05-22-libghostty-c-abi.md` (vt, not full surface) and
  `2026-06-01-libghostty-key-input-encoding.md` (key encoding on the render thread)
- **Scope**: make the embedded terminal honor the user's Ghostty config, themes, keybindings
  and presentational features so the experience matches Ghostty/cmux as closely as an embedded
  canvas pane honestly can.

## Context

The terminal already runs Ghostty's **VT core**: `libghostty-vt` parses output and encodes
keyboard input (mode-aware) on the render thread. What is missing is the Ghostty **app layer**,
which `libghostty-vt` deliberately does not provide: config-file parsing, theme loading,
app-level keybinding actions, and the renderer features that consume them.

Audit of the current state (`src/features/sessions/terminalRenderer.ts`, `useTerminalCanvas.ts`,
`crates/mizraj-term`, `src-tauri/src/session/*`):

- Font is three hardcoded constants (`FONT_SIZE_PX=13`, `LINE_HEIGHT_RATIO=1.2`, a fixed
  `FONT_FAMILY`). The 16+256 palette is a frozen module-level array. Only default bg/fg are
  config-driven, via two CSS vars read **once** at mount.
- There is **no cursor rendered**, **no selection/mouse**, **no scrollback UI**, **no
  keybinding-action layer** (every non-meta key is encoded straight to the PTY), and **no
  Ghostty config is read at all**.
- libghostty-vt already exposes — and we currently ignore — per-cell tagged colors, underline
  style, wide cells, hyperlink ids, grapheme buffers, cursor x/y/style/blink, scrollback
  viewport, selection helpers, the mouse encoder, OSC handlers (title, OSC7/8/52), and resolved
  palette getters. **The gap is almost entirely host plumbing we have chosen not to wire.**

### Reference: how cmux does it

`manaflow-ai/cmux` (the terminal in daily use) is a **native macOS Swift app that embeds the
full Ghostty GPU surface** (`GhosttyNSView`) and bundles all ~463 Ghostty theme files verbatim.
It gets config/themes/keybindings for free because it literally runs Ghostty. Its
`GhosttyConfig.swift` also re-parses the config file in-process with a tiny line parser
(trim → strip BOM → skip `#`/empty → split first `=` → strip quotes → switch on key), resolves
`theme = light:..,dark:..`, parses `palette = N=#hex`, and coalesces appearance changes at ~30fps
for hot-reload. That parser and the theme-file format are directly reusable; the GPU-surface
embed is **not** the path we take (see below).

## Decision

**Voie B — rebuild the Ghostty app layer on top of the existing `libghostty-vt` + `<canvas>`
architecture.** We do **not** embed the full Ghostty GPU surface (Voie A, the cmux way).

Rationale (consistent with the C-ABI ADR's deliberate tradeoff):

1. **Cross-platform.** The vt path ships for macOS/Linux/Windows; the GPU surface would be
   macOS-only native AppKit/Metal glue.
2. **DOM compositing is the product.** DiffPanel, menus, and HTML plan overlays composite
   **over** the terminal canvas. A native GPU subview sits above the webview and would fight the
   compositor — it breaks the core Mizraj UI model.
3. **Voie A is a V12 reversal** that throws away the vt+canvas investment for pixel-exact parity
   we don't need. The gap matrix shows Voie B is mostly **wiring already-bound C APIs**, not
   building from scratch.

Voie A's only unique wins (native tabs/splits/windows, true window blur, GPU effects) are exactly
the items that are out of scope for a single embedded pane anyway (see _Out of scope_).

### Scope: Core + Extended, plus URL/OSC8 links and ligatures

In Ghostty-config terms, honored vs not:

- **`must` (core parity):** read `~/.config/ghostty/config` (+ macOS path) with the line parser;
  resolve `theme`; full 256 `palette` + `background`/`foreground`; `font-family` (+ variants) +
  `font-size` + `adjust-cell-*`; **render the cursor** + `cursor-style`; a keybinding-action
  dispatch layer + `copy/paste/select_all` + a selection model + font-size shortcuts + the
  `super` modifier; **PTY query responses** (DSR/DA via `OPT_WRITE_PTY` — correctness).
- **`should` (extended parity):** scrollback + scroll keybinds; mouse-event encoding (app mouse
  modes); wide/CJK + grapheme correctness; `window-padding-*`; OSC-0/2 title → session label;
  `copy-on-select`; `bold-is-bright`; `background-opacity`; `theme = light:..,dark:..`;
  cursor blink/color/invert; `clear_screen`/`reset`; hot-reload; `scrollback-limit`;
  `adjust-underline/strikethrough/cursor-thickness`; `selection-background/foreground`;
  `text:`/`esc:` rebinds.
- **chosen `optional`:** **URL/OSC8 clickable links** (open via the Tauri opener plugin);
  **ligatures / `font-feature`** — note this requires re-architecting the renderer to draw
  multi-cell runs instead of one glyph per cell, so it is sequenced last.
- **cut for now:** in-buffer search, kitty graphics/inline images, and the remaining
  `optional` items (min-contrast, underline styles, OSC52 system clipboard, OSC7, bell,
  scrollbar, mouse-scroll-multiplier, shell-integration injection).

### Out of scope (cannot be honored faithfully by a single embedded canvas pane)

Native tabs/splits/windows and window lifecycle; `background-blur` (no native translucent window
behind the canvas); clipboard ask/paste-protection modals; `font-thicken`; command-palette /
inspector overlays; GPU vsync/alpha effects. These are Ghostty **app-window** concerns the
embedded pane does not own.

## Foundation (the spine every feature depends on)

1. **Rust config reader + line parser** (`load_ghostty_config`) — I4. Resolve `$HOME`
   (db.rs idiom), read XDG then macOS Application Support path in order, parse `key = value`
   (trim, split first `=`, `#`-own-line comments, empty value = reset, repeatable keys
   accumulate, optional quotes), handle `config-file` includes (`?optional`, relative-to-parent,
   processed at EOF). Native `std::fs`, no capability widening; register in `lib.rs`.
2. **Theme resolver** — I4. `theme = name | light:..,dark:.. | abs-path`; search
   `~/.config/ghostty/themes` then bundled dir; parse the fragment with the same parser as a
   **base layer**; explicit user `background`/`foreground`/`palette` override it.
3. **Resolved-config DTO + backend palette resolution** — I6. One typed serde struct = the
   effective config after theme+overrides merge: `palette[256]` as RGB, fg/bg/cursor colors,
   font family/variants/size/features, `adjust-*` metrics, cursor style/blink/opacity, padding,
   opacity, bold-is-bright, scrollback-limit, term. Resolve indexed/default → RGB on the backend,
   killing the frontend's hardcoded `ANSI_16`/`buildPalette`.
4. **Renderer config injection** (react-implementer) — I6. Widen `TerminalTheme` → a full
   `TerminalConfig` threaded through `drawFrame`/`drawCell`; re-run `measureCell` when font
   changes (currently once).
5. **Settings bridge + hot-reload** — I4. Backend emits `config-changed` on reload; frontend
   re-pulls the DTO and re-injects (re-measure + repaint). User overrides stay in plugin-store;
   the Ghostty file is the source.

## Roadmap (milestones on `feat/ghostty`, vertical slices, commit per slice)

- **M0 Foundation** — the 5 items above.
- **M1 Themes & colors** — palette/bg/fg/theme/light-dark/bold-is-bright/opacity.
- **M2 Font & text** — family+variants, size, adjust-cell-*, then wide-char + grapheme
  correctness (wire fields).
- **M3 Cursor** — wire cursor state; draw pass; style/blink/color/invert/opacity.
- **M4 Keybindings** — dispatch layer (+ `super`, `physical:`, sequences); copy/paste/select-all,
  font-size, scroll, clear/reset, text:/esc:.
- **M5 Mouse & selection** — selection model + highlight + extract; selection colors;
  copy-on-select; mouse-event encoding to PTY.
- **M6 Scrollback** — viewport scroll (wheel + keybind); `scrollback-limit` (bytes).
- **M7 Misc** — `window-padding-*`; OSC title → label; PTY query responses (DSR/DA).
- **M8 URL/OSC8 links** — hyperlink wire field + detection + hover/click + opener.
- **M9 Ligatures / font-feature (V8)** — renderer rearchitecture to run-based drawing. Last.

## Verification

The pinned `libghostty.dylib` is already built locally (`target/libghostty/`), CLT 26.3 (the
required pre-26.4 SDK). Builds/tests run here with `LIBGHOSTTY_LIB_DIR=target/libghostty`:
`cargo test` for Rust, `tsc --noEmit` + `vitest` for the frontend. Ghostty config/theme/keybind
behavior is validated against context7 (`/ghostty-org/website`, `/websites/libghostty_tip_ghostty`)
throughout. Each slice ships with tests and is `/simplify`-reviewed before commit.
