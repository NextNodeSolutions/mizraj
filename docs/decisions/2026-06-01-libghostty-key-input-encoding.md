# ADR — Keyboard input encoded by libghostty on the render thread

- **Date**: 2026-06-01
- **Decision refs**: D2/D4 (embedded-terminal-pty); follows the C-ABI ADR (`2026-05-22-libghostty-c-abi.md`)
- **Scope**: the input direction of the embedded terminal — how a webview `KeyboardEvent` becomes PTY bytes

## Context

The output direction was already libghostty end-to-end: PTY bytes → `Terminal::feed` on
the render thread → `RenderState` snapshot → `agent:cells`. The first cut of the input
direction went the other way: a hand-rolled VT/xterm encoder in the **frontend**
(`src/lib/vtEncode.ts`) mapped `KeyboardEvent` → bytes, sent to a `session_write(bytes)`
command.

That frontend encoder is **stateless**, and terminal input encoding is **not** state-free:

- Arrow keys must emit `ESC O A` (not `ESC [ A`) once an application enables
  application-cursor-key mode (DECCKM); `vi`, `less`, and most full-screen TUIs do this.
- Backspace (`0x7f` vs `0x08`), Alt-as-ESC-prefix, modifyOtherKeys, and the kitty keyboard
  protocol are all driven by modes the **child** sets at runtime.

The frontend cannot see those modes — they live in the libghostty `Terminal`, which is owned
by the render thread and is `!Send`. So the frontend encoder could only guess, and guessed
wrong for any app that touched a mode. Meanwhile libghostty already ships a complete,
mode-aware key encoder (`ghostty_key_encoder_*` + `ghostty_key_event_*`), already vendored and
bound in `agent-cockpit-term-sys`. Maintaining a second, weaker encoder in JS violated the
platform-native rule.

## Decision

**Encode keyboard input in the backend, on the render thread, via libghostty's key encoder.**
The frontend ships the raw `KeyboardEvent` fields; Rust does all VT encoding.

Data flow:

```
keydown → useTerminalCanvas: KeyStroke DTO { code, text, ctrl, alt, shift }
        → invoke('session_key') → commands::session_key → manager.send_key
        → dispatch_to_sinks → TermSink::key  (same fan-out as resize)
        → RenderInput::Key on the render thread's channel
        → KeyEncoder::encode(&terminal, …)   // setopt_from_terminal first
        → non-empty bytes → writer_tx.try_send → pty_write_loop → PTY → child
```

- `crates/agent-cockpit-term/src/key.rs` — safe `KeyEncoder`/`Mods` wrapper over the FFI,
  same NonNull + SAFETY + Drop template as `render_state.rs`. `encode` calls
  `ghostty_key_encoder_setopt_from_terminal` **before every keystroke** (modes change between
  presses), builds a fresh `GhosttyKeyEvent`, and returns the bytes (empty for lone
  modifiers / unmapped keys). A private `w3c_code_to_ghostty` maps `KeyboardEvent.code` →
  `GhosttyKey` (the enum is itself the W3C-code set), the only place the raw enum is named.
- The render thread owns one reusable encoder and a clone of the PTY input channel
  (`writer_tx`), so it both renders output and writes encoded input. Delivery is best-effort
  (`try_send`, never `blocking_send`) — a wedged child drops a keystroke rather than stalling
  the render loop, matching the existing `write`/`resize` discipline.

`session_write(bytes)` and the frontend encoder are removed (greenfield replacement, no compat
shim). The committed `send_input`/`pty_write_loop` PTY-input channel is reused, not rebuilt.

## Why this altitude

1. **Encoding must happen where the modes live.** The `Terminal` (and thus DECCKM, kitty
   flags, backarrow, …) is `!Send` and lives only on the render thread; `setopt_from_terminal`
   reads them there. Any frontend or command-layer encoder would need a mode mirror — a
   second source of truth with a sync window. Encoding on the render thread has none.
2. **One encoder, not two.** Output already trusts libghostty; input now does too. Correctness
   for arrows/kitty/modified keys comes for free from the engine thousands of Ghostty users
   exercise daily, instead of a bespoke table we maintain.
3. **The route is cheap.** The only non-trivial hop is the single `invoke` IPC — identical to
   the old design and to how VS Code's terminal works (renderer → IPC → pty). The added
   in-process channel hops are micro/nanosecond-scale, invisible at human typing speed.

## Verification

`KeyEncoder` is unit-tested directly, including the case the frontend encoder got wrong:
feeding `ESC [ ? 1 h` to a real `Terminal`, then encoding `ArrowUp`, yields `ESC O A` (not
`ESC [ A`). End-to-end: `vi` arrows move the cursor, `Ctrl-C` interrupts, `ls\n` runs.

## Alternatives rejected

- **Keep encoding in JS** — the discarded design; structurally cannot see terminal modes.
- **Encode in the `session_key` command (off the render thread)** — needs a mode mirror synced
  from the render thread; reintroduces the sync-window bug `setopt_from_terminal` exists to
  avoid.
- **Dedicated key channel on `SessionHandle`** — leaks the render thread's private
  `RenderInput` type up into the Tauri-agnostic manager; the sink fan-out (`OutputSink::key`,
  mirroring `resize`) keeps that coupling out.

## References

- `crates/agent-cockpit-term-sys/vendor/include/ghostty/vt/key/encoder.h`, `key/event.h`
- `crates/agent-cockpit-term/src/key.rs`, `src-tauri/src/session/term_sink.rs`
- C-ABI ADR — `docs/decisions/2026-05-22-libghostty-c-abi.md`
