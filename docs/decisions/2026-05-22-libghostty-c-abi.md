# ADR — libghostty C ABI strategy (OQ3 spike)

- **Date**: 2026-05-22
- **Linear**: SAS-392 — `[P1-01] Spike: validate libghostty C ABI stability (OQ3)`
- **Decision refs**: D2 (interview `embedded-terminal-pty`, 2026-05-22)
- **Scope**: gates the bindgen strategy for `crates/agent-cockpit-term-sys`

## Context

D2 of the embedded-terminal-pty interview committed to a two-crate Rust binding for libghostty:

- `crates/agent-cockpit-term-sys` — `bindgen` over libghostty C headers, links the dynamic library, all `unsafe` confined here.
- `crates/agent-cockpit-term` — safe wrapper exposing `Terminal::feed(bytes) -> Cells`.

D2 explicitly flagged a pre-implementation spike (OQ3): does libghostty expose a stable C ABI we can bindgen against directly, or do we have to write our own thin Zig→C wrapper inside the ghostty source tree?

The wrapper-required path is materially more expensive (V8 vs I4): vendoring/forking ghostty, maintaining the Zig stub through every upstream bump, building Zig in CI on day one (which D2's edge case explicitly rules out).

## Investigation

Source: <https://github.com/ghostty-org/ghostty> @ `main`, inspected 2026-05-22.

### What ghostty actually ships

Ghostty exposes **two distinct C surfaces**, intentionally separated upstream:

1. **`include/ghostty.h`** — full *app* embedding API.
   - Surface: `ghostty_app_*`, `ghostty_surface_*` (GPU-rendered surface), `ghostty_config_*`, `ghostty_inspector_*`, mouse / IME / clipboard / splits.
   - Header comment: *"The only consumer of this API is the macOS app, but the API is built to be more general purpose."*
   - **Rejected for us**: includes a native GPU surface — D1 explicitly ruled out the WGPU/native-overlay path because it breaks the Tauri single-webview model.

2. **`include/ghostty/vt.h`** + `include/ghostty/vt/*.h` — dedicated `libghostty-vt` C API.
   - Build target: `libghostty-vt.{dylib,so,dll}`, gated by `emit_lib_vt = true` in `src/build/Config.zig` (and a top-level CMake `zig_build_lib_vt` target).
   - Zig entry point: `src/lib_vt.zig`. C ABI re-exports in `src/terminal/c/main.zig`. `@export` calls live in `src/lib_vt.zig`. Headers per module under `include/ghostty/vt/`.
   - **Designed for our exact use case**: parse VT escapes, maintain terminal state (cursor, screen, scrollback, modes, styles), expose cells for a custom renderer.

`libghostty-vt` is the surface we want. The full `ghostty.h` is irrelevant for our embedding path.

### Surface mapping vs D2

The crate-level shape `init / feed / cells / free` from D2 maps cleanly onto libghostty-vt:

| D2 verb | libghostty-vt C symbol | Header |
|---|---|---|
| `init` | `ghostty_terminal_new(const GhosttyAllocator*, GhosttyTerminal*, GhosttyTerminalOptions)` | `vt/terminal.h` |
| `feed` | `ghostty_terminal_vt_write(GhosttyTerminal, const uint8_t* data, size_t len)` | `vt/terminal.h` |
| `cells` (grid traversal) | `ghostty_terminal_grid_ref(...)`, `ghostty_terminal_point_from_grid_ref(...)`, plus `vt/grid_ref.h` cell accessors | `vt/terminal.h`, `vt/grid_ref.h` |
| `cells` (incremental render) | `ghostty_render_state_*` family — `render_state_new/free/update/get`, `row_iterator_*`, `row_cells_*` | `vt/render.h` |
| `free` | `ghostty_terminal_free(GhosttyTerminal)` | `vt/terminal.h` |

Auxiliary symbols we'll need:

- `ghostty_terminal_resize(GhosttyTerminal, cols, rows, cell_w_px, cell_h_px)` — wired to PTY resize once D3 lands.
- `ghostty_terminal_set(GhosttyTerminal, GHOSTTY_TERMINAL_OPT_WRITE_PTY, callback)` — required to handle DSR / DA / device-attribute replies (vt_write generates them; default behavior silently drops them).
- Callback typedefs: `GhosttyTerminalWritePtyFn`, `GhosttyTerminalBellFn`, `GhosttyTerminalTitleChangedFn` — optional but cheap to wire and useful for the cockpit UX (title in sidebar, bell on attention).
- `GhosttyAllocator` — runtime-swappable allocator struct; default `ghostty_allocator_default()` is fine for V1.

### ABI stability statements (verbatim from upstream)

`include/ghostty/vt.h` preamble:

> WARNING: This is an incomplete, work-in-progress API. It is not yet stable and is definitely going to change.

`src/lib_vt.zig`:

> The functionality is extremely stable, since it is extracted directly from Ghostty which has been used in real world scenarios by thousands of users for years. However, the API itself (functions, types, etc.) may change without warning. We're working on stabilizing this in the future.

`src/terminal/c/AGENTS.md` (upstream contributor guide for this exact module):

> - C API must be designed with ABI compatibility in mind
> - Prefer opaque pointers for long-lived objects, such as `GhosttyTerminal`.
> - Structs: may use the "sized struct" pattern: an `extern struct` with `size: usize = @sizeOf(Self)` as the first field. In the C header, callers use `GHOSTTY_INIT_SIZED` from `types.h` to zero-initialize and set the size.

In short: the **runtime behavior** is battle-tested (Ghostty is the rendering engine for thousands of users), the **C surface shape** is designed with ABI compat in mind (opaque handles, sized structs, dedicated header tree), but upstream has not yet committed to source-level or ABI stability across versions.

## Verdict

**`stable-abi`** — upstream headers suffice. No Zig→C wrapper of our own.

Bind directly against `include/ghostty/vt.h` (and its included subheaders under `include/ghostty/vt/`) from `crates/agent-cockpit-term-sys/build.rs` using `bindgen`. Link against `libghostty-vt.{dylib,so,dll}` produced by upstream `zig build -Demit-lib-vt`.

### Why this is the right call, not wrapper-required

1. **The C surface we'd write already exists upstream, maintained by ghostty-org.** Writing a parallel Zig stub would duplicate `src/terminal/c/main.zig` while being strictly worse — we'd have to track every `Terminal` internal change ourselves, which is exactly what ghostty's own C layer already does (and gets reviewed by ghostty maintainers).
2. **Wrapper-required does not solve the stability concern.** Upstream "may change without warning" affects both the C ABI *and* the underlying Zig `Terminal` type. A custom wrapper would still break on Zig-side changes — we'd just move the breakage from `bindgen` regeneration to manually patching Zig.
3. **D2's edge case is the right mitigation.** D2 already commits to: dynamic linking, version pinned exactly in Cargo workspace, checksum verified in CI. That captures the "API may move" risk cleanly: a `libghostty-vt` upgrade is a deliberate, reviewable diff (regenerated bindings + any safe-wrapper adjustments), not an ambient liability.
4. **The header surface explicitly anticipates ABI evolution.** Sized structs with `size_t` first field, opaque `GhosttyTerminal` handle, function-pointer option setters via `ghostty_terminal_set(...)` — these are exactly the patterns one uses to *grow* an ABI without breaking old callers. ghostty-org is investing in compat, even without a public SLA yet.
5. **The full `ghostty.h` is a red herring.** D2's risk framing assumed there might only be the app-embedding API. There isn't — `libghostty-vt` is a separate, deliberately-scoped library that exists precisely so non-Ghostty consumers can embed the VT engine without the GPU surface. We are exactly the target audience.

### Out of scope for this ADR (handled elsewhere)

- Renderer architecture (cells → `<canvas>`) — D1.
- PTY plumbing — D3.
- Session lifecycle and SQLite scrollback — D4, D7, D8.
- Exact pinned `libghostty-vt` version + checksum — to be filed alongside SAS-378 (`[P1-02] Create agent-cockpit-term-sys crate skeleton`) when we pick the first release tag and wire the CI checksum.
- Distribution of the prebuilt `libghostty-vt` binary on macOS / Linux — SAS-377, SAS-376.

## References

- `include/ghostty/vt.h` — <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt.h>
- `include/ghostty/vt/terminal.h` — <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/terminal.h>
- `src/lib_vt.zig` — <https://github.com/ghostty-org/ghostty/blob/main/src/lib_vt.zig>
- `src/terminal/c/main.zig` — <https://github.com/ghostty-org/ghostty/blob/main/src/terminal/c/main.zig>
- `src/terminal/c/AGENTS.md` — <https://github.com/ghostty-org/ghostty/blob/main/src/terminal/c/AGENTS.md>
- D2 interview decision — `docs/interviews/embedded-terminal-pty/submission.json`
- Plan — `docs/plans/2026-05-22-embedded-terminal-pty.html`
