# Track scope — bundling libghostty all-in-one

- **Date**: 2026-05-31
- **Effort**: V8
- **Status**: à planifier (via `/interview` → `/backlog`) — PAS encore une track active
- **Décision amont**: garder `libghostty-vt` (cf. ADR `docs/decisions/2026-05-22-libghostty-c-abi.md`, amendement 2026-05-31)

## Objectif

L'utilisateur final (et idéalement le dev) n'a **rien** à installer : `libghostty` est
construit depuis la source (Zig) et **embarqué dans le bundle de l'app** (`.app` macOS,
puis Linux/Windows), façon cmux. Aujourd'hui le dev doit lancer
`scripts/setup-libghostty.sh` à la main — c'est l'étape transitoire « débloquer le dev »,
pas l'état final.

## Modèle retenu (confirmé via doc Cargo, context7)

- `mizraj-term-sys` est un paquet `-sys` canonique : il lie la lib native et expose
  les symboles bruts, sans abstraction.
- Modèle « system library » (la lib vit hors cargo, `build.rs` la _trouve_ via
  `LIBGHOSTTY_LIB_DIR`) — **pas** le modèle « vendored build-at-compile » : un build
  réseau + Zig à chaque `cargo build` casserait `--offline`/`--frozen` (reproductibilité).
- Source du dylib : **build-from-source via Zig** (`zig build -Demit-lib-vt`), Zig **0.15.2**
  (pin lu dans le `build.zig.zon` du commit ghostty `d5d8cef`). libghostty-vt ne dépend que
  de libc → cross-compilation simple.

## À faire dans la track

- [ ] **CI**: job qui installe Zig 0.15.2, build `libghostty-vt` par plateforme/arch
      (macOS arm64 + x64 au minimum), cache l'artefact.
- [ ] **Bundle Tauri**: copier le `.dylib` dans le `.app` via `bundle.macOS.frameworks`
      (ou resources) + vérifier que le rpath `@executable_path`/`@loader_path` déjà émis par
      `build.rs` résout au runtime dans l'app packagée.
- [ ] **Nom d'artefact**: upstream produit `libghostty-vt.dylib` (name `ghostty-vt`) alors
      que `build.rs` linke `-lghostty` / cherche `libghostty.dylib`. Le script dev gère ça par
      copie + `install_name_tool -id`. La track doit décider : soit garder ce renommage, soit
      aligner `build.rs` sur `ghostty-vt`. **Choisir une seule voie, pas un hybride.**
- [ ] **`links = "ghostty"` dans `crates/mizraj-term-sys/Cargo.toml`** — actuellement
      ABSENT. La doc Cargo recommande la clé `links` pour un `-sys` : empêche les doublons de
      symboles et permet de passer des métadonnées entre build scripts. Petite dette à combler.
- [ ] **Signing / notarization macOS**: un dylib embarqué doit être signé avec l'app
      (codesign + entitlements). À vérifier vu que la CI release est passée en unsigned.
- [ ] **Dev ergonomics**: `scripts/setup-libghostty.sh` reste pour le dev local ; envisager
      direnv pour exporter `LIBGHOSTTY_LIB_DIR` automatiquement.
- [ ] **Linux/Windows**: étendre le bundling (`.so` rpath `$ORIGIN` déjà géré côté `build.rs`).

## Hors scope ici

- Le rendu (canvas) — déjà fait dans M2.A (`src/lib/terminalRenderer.ts`).
- Le choix vt vs full surface — tranché dans l'ADR.
