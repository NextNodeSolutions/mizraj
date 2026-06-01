#!/usr/bin/env bash
#
# setup-libghostty.sh — build libghostty-vt from source for local dev.
#
# Why this exists: `crates/mizraj-term-sys` links against
# libghostty-vt at build time via the LIBGHOSTTY_LIB_DIR env var. Upstream
# ships no per-commit prebuilt dylib, so we build it from the exact pinned
# ghostty commit (the same SHA our vendored headers track).
#
# This is a DEV convenience for `pnpm dev`. The reproducible CI build + the
# bundling of the dylib into the packaged .app are a separate, planned track;
# this script is intentionally a one-shot local unblock, not that pipeline.
#
# Usage:
#   ./scripts/setup-libghostty.sh           # build + install, print export line
#   eval "$(./scripts/setup-libghostty.sh --print-env)"   # build + export in shell
#
# After running once, add the printed line to your shell rc (or use direnv).

set -euo pipefail

# --- Resolve repo paths ------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TERM_SYS_DIR="$REPO_ROOT/crates/mizraj-term-sys"
VERSION_FILE="$TERM_SYS_DIR/vendor/VERSION"

# Build artifacts live OUTSIDE the repo (heavy, machine-specific); the final
# dylib is copied INTO target/ (gitignored) where build.rs can find it.
WORK_DIR="${LIBGHOSTTY_WORK_DIR:-$HOME/.cache/mizraj/libghostty}"
INSTALL_DIR="$REPO_ROOT/target/libghostty"

# Ghostty pins a strict Zig version in build.zig.zon. As of the pinned commit
# this is 0.15.2 — bump here only when the pin moves and you've checked the new
# build.zig.zon. A mismatched Zig will fail the build loudly, not silently.
ZIG_VERSION="${ZIG_VERSION:-0.15.2}"

log() { printf '\033[1;36m[libghostty]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[libghostty] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

PRINT_ENV=0
[ "${1:-}" = "--print-env" ] && PRINT_ENV=1

# --- Read the pinned ghostty commit ------------------------------------------
[ -f "$VERSION_FILE" ] || die "pin file not found: $VERSION_FILE"
GHOSTTY_SHA="$(tr -d '[:space:]' < "$VERSION_FILE")"
[ -n "$GHOSTTY_SHA" ] || die "empty pin in $VERSION_FILE"
log "pinned ghostty commit: $GHOSTTY_SHA"

# --- Ensure Zig --------------------------------------------------------------
# Ghostty needs the exact pinned Zig; a system/brew Zig of another version will
# break. We fetch the official toolchain into the work dir if absent.
ZIG_DIR="$WORK_DIR/zig-$ZIG_VERSION"
ZIG_BIN="$ZIG_DIR/zig"
if [ ! -x "$ZIG_BIN" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) ZIG_ARCH="aarch64-macos" ;;
    Darwin-x86_64) ZIG_ARCH="x86_64-macos" ;;
    Linux-x86_64) ZIG_ARCH="x86_64-linux" ;;
    Linux-aarch64) ZIG_ARCH="aarch64-linux" ;;
    *) die "unsupported platform: $(uname -s)-$(uname -m)" ;;
  esac
  ZIG_TARBALL="zig-${ZIG_ARCH}-${ZIG_VERSION}.tar.xz"
  ZIG_URL="https://ziglang.org/download/${ZIG_VERSION}/${ZIG_TARBALL}"
  log "downloading Zig ${ZIG_VERSION} (${ZIG_ARCH}) — this needs network"
  mkdir -p "$WORK_DIR"
  curl -sSfL "$ZIG_URL" -o "$WORK_DIR/$ZIG_TARBALL" || die "Zig download failed: $ZIG_URL"
  tar -xf "$WORK_DIR/$ZIG_TARBALL" -C "$WORK_DIR"
  mv "$WORK_DIR/zig-${ZIG_ARCH}-${ZIG_VERSION}" "$ZIG_DIR"
  rm -f "$WORK_DIR/$ZIG_TARBALL"
fi
log "using zig: $($ZIG_BIN version)"

# --- Clone ghostty at the pinned commit --------------------------------------
GHOSTTY_SRC="$WORK_DIR/ghostty"
if [ ! -d "$GHOSTTY_SRC/.git" ]; then
  log "cloning ghostty — this needs network"
  git clone --filter=blob:none https://github.com/ghostty-org/ghostty.git "$GHOSTTY_SRC"
fi
git -C "$GHOSTTY_SRC" fetch --depth 1 origin "$GHOSTTY_SHA" 2>/dev/null || true
git -C "$GHOSTTY_SRC" checkout -q "$GHOSTTY_SHA" || die "cannot check out $GHOSTTY_SHA"
log "ghostty checked out at $(git -C "$GHOSTTY_SRC" rev-parse --short HEAD)"

# --- Build libghostty-vt -----------------------------------------------------
# libghostty-vt depends only on libc, so this is a plain release build. The
# artifact lands under PREFIX/lib as libghostty-vt.dylib (name "ghostty-vt").
PREFIX="$WORK_DIR/prefix"
rm -rf "$PREFIX"

# PREREQUISITE on macOS (ziglang/zig #31658): Zig 0.15.2 — the version ghostty
# pins — cannot link against the macOS 26.4 SDK (Command Line Tools 26.4): its
# libSystem.tbd carries arm64e entries that aarch64-macos doesn't match, so
# every libc symbol comes up undefined. The fix (PR #31673) is on Zig's 0.15.x
# branch but NOT in the 2025-10-11 0.15.2 release binary, and ghostty requires
# exactly 0.15.2, so bumping Zig is not an option. Resolution: use Command Line
# Tools 26.3 or earlier (xcode-select / developer.apple.com downloads). With a
# pre-26.4 SDK active, the build below is a plain native build. The reproducible
# CI/bundle build is expected to cross-compile and sidesteps this entirely.

log "building libghostty-vt (zig build -Demit-lib-vt) — slow on first run"
# The build emits the dylib early, then a final `install` step assembles an
# .xcframework via `xcodebuild` — which needs full Xcode, not just the Command
# Line Tools. That step failing is expected and harmless here: we only need the
# dylib, which is already in PREFIX/lib by then. So don't abort on the build's
# exit code; verify the artifact below instead.
( cd "$GHOSTTY_SRC" && "$ZIG_BIN" build -Demit-lib-vt -Doptimize=ReleaseFast --prefix "$PREFIX" ) || \
  log "zig build returned non-zero (likely the Xcode-only xcframework step); checking for the dylib anyway"

case "$(uname -s)" in
  Darwin) DYLIB_EXT="dylib" ;;
  Linux) DYLIB_EXT="so" ;;
  *) die "unsupported OS for dylib copy" ;;
esac
# Zig installs the dylib with its version in the name (libghostty-vt.0.1.0.dylib)
# and may or may not symlink the unversioned name depending on how far the failed
# install step got. Pick the unversioned one if present, else the newest match.
SRC_LIB="$PREFIX/lib/libghostty-vt.$DYLIB_EXT"
if [ ! -f "$SRC_LIB" ]; then
  SRC_LIB="$(ls -1 "$PREFIX"/lib/libghostty-vt*."$DYLIB_EXT" 2>/dev/null | head -1)"
fi
[ -n "$SRC_LIB" ] && [ -f "$SRC_LIB" ] || die "no libghostty-vt.$DYLIB_EXT under $PREFIX/lib"

# --- Install under target/ with the name build.rs expects --------------------
# build.rs links `-lghostty` and looks for `libghostty.<ext>`, but the upstream
# artifact is `libghostty-vt.<ext>`. Copy it under the expected name AND fix the
# dylib's own install_name so the @rpath lookup resolves at runtime (the embed
# default would otherwise reference libghostty-vt).
mkdir -p "$INSTALL_DIR"
DST_LIB="$INSTALL_DIR/libghostty.$DYLIB_EXT"
cp -f "$SRC_LIB" "$DST_LIB"
if [ "$DYLIB_EXT" = "dylib" ]; then
  install_name_tool -id "@rpath/libghostty.dylib" "$DST_LIB"
fi
log "installed: $DST_LIB"

# --- Emit the env the build needs --------------------------------------------
EXPORT_LINE="export LIBGHOSTTY_LIB_DIR=\"$INSTALL_DIR\""
if [ "$PRINT_ENV" = "1" ]; then
  printf '%s\n' "$EXPORT_LINE"
else
  log "done. Add this to your shell (or run: eval \"\$(./scripts/setup-libghostty.sh --print-env)\"):"
  printf '\n    %s\n\n' "$EXPORT_LINE"
fi
