# Vendored libghostty-vt headers

`include/` mirrors `include/ghostty/` from the upstream
[ghostty-org/ghostty](https://github.com/ghostty-org/ghostty) tree.

- **Upstream commit**: `d5d8cef4d3834cc8999eb9344066b0960b033f2d`
- **Vendored on**: 2026-05-24
- **Surface**: `include/ghostty/vt.h` plus everything under `include/ghostty/vt/`.
  The full app embedding API (`include/ghostty/ghostty.h`) is deliberately
  **not** vendored — we only bind the standalone `libghostty-vt` surface
  (see `docs/decisions/2026-05-22-libghostty-c-abi.md`).

## Regenerating

The headers are read by `crates/agent-cockpit-term-sys/build.rs` and fed to
`bindgen`. To pull a newer upstream snapshot:

```sh
SHA=<new commit sha>
DEST=crates/agent-cockpit-term-sys/vendor/include/ghostty
rm -rf "$DEST"
mkdir -p "$DEST/vt/key" "$DEST/vt/mouse"
curl -sSfo "$DEST/vt.h" \
  "https://raw.githubusercontent.com/ghostty-org/ghostty/$SHA/include/ghostty/vt.h"
for f in allocator build_info color device focus formatter grid_ref \
         grid_ref_tracked key kitty_graphics modes mouse osc paste point \
         render screen selection sgr size_report style sys terminal types wasm; do
  curl -sSfo "$DEST/vt/$f.h" \
    "https://raw.githubusercontent.com/ghostty-org/ghostty/$SHA/include/ghostty/vt/$f.h"
done
for sub in key mouse; do
  for f in encoder event; do
    curl -sSfo "$DEST/vt/$sub/$f.h" \
      "https://raw.githubusercontent.com/ghostty-org/ghostty/$SHA/include/ghostty/vt/$sub/$f.h"
  done
done
```

Then update this file's *Upstream commit* + *Vendored on* lines and rerun
`cargo build -p agent-cockpit-term-sys`.

Pinning policy (workspace `libghostty-vt` version + checksum verification in
CI) is owned by `SAS-382` / `[P1-06]`.

## Override at build time

Set `LIBGHOSTTY_INCLUDE_DIR=/abs/path/to/include` to bypass these vendored
headers and bind against a system-installed or out-of-tree copy.
