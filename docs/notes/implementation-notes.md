# Implementation notes — intégration Ghostty (feat/ghostty)

Journal des décisions hors-spec, changements imprévus et tradeoffs, tenu au fil de l'eau.
Démarré le 2026-06-12. Périmètre : M11→M17 du plan + terminal sans Claude + multi-terminal.

## 2026-06-12 — État des lieux et environnement

- **Cache cargo périmé après renommage du repo** : le repo a été déplacé de
  `~/Development/nextnode/agent-cockpit` vers `~/Development/tools/mizraj`. Les build
  scripts (tauri) et les binaires de test (`mizraj-vcs`, via `env!("CARGO_MANIFEST_DIR")`
  figé à la compilation) référençaient l'ancien chemin. Fix : `cargo clean -p tauri -p
  mizraj -p mizraj-vcs`. Si d'autres erreurs « No such file or directory …
  agent-cockpit… » apparaissent, même remède sur le crate concerné.
- **`pnpm lint` (oxlint racine) crashe** (« process terminated abnormally, possibly out
  of memory ») alors que `pnpm exec oxlint src` passe en 114 ms. Le scan racine avale
  probablement un artefact volumineux. Non corrigé (hors périmètre) ; je linte `src`
  directement. À investiguer côté oxlint.config.ts si ça devient gênant.
- **M11.A.01 trouvé déjà implémenté mais non commité** dans l'arbre de travail (bridge
  global `agent:cells` → `cellFramesAtom`). Vérifié contre le done_when (idempotence du
  bridge testée, frame bufferisée peinte au mount, flux live intact), tests verts →
  commité tel quel (`2a866a7`) plutôt que réécrit.

## 2026-06-12 — M11 (perf multi-pane) + hot-reload

- **Abonnement = bool, pas refcount** (`session_subscribe`/`unsubscribe`). L'app
  n'affiche qu'un pane par session aujourd'hui. Si le CockpitGrid (M6) monte un jour
  deux panes de la même session, l'unmount de l'un coupera les frames de l'autre →
  passer à un compteur côté backend à ce moment-là.
- **Catch-up gratuit au resubscribe** : pendant qu'une session est cachée on saute
  `render_state.update()` ; le damage s'accumule côté libghostty, donc le premier
  update post-subscribe ressort tout en une frame. Pas de replay manuel nécessaire.
- **Pacing 120fps choisi côté render thread** (attente `recv_timeout` qui replie
  l'input dans la frame en attente) plutôt qu'un timer côté émission : la dernière
  frame d'un burst n'est jamais perdue, et un flot continu coûte au plus ~125
  émissions IPC/s par session visible.
- **`session_get_frame` n'altère pas la comptabilité dirty** (pas de `mark_clean` sur
  le pull) : au pire la frame live suivante répète le même contenu. Évite tout trou
  bridge/atom au prix d'un dup idempotent.
- **Ordre M7.A.05 ↔ M11.A.05 inversé vs plan** : le hot-reload (DG3) n'existait pas
  alors que le cache TP4 doit s'invalider dessus. Fait DG3 d'abord (watcher `notify`
  v8 + event `ghostty:config-changed` + atome epoch Jotai), puis le cache TP4 en
  pull-based sur l'epoch (pas d'abonnement au module-scope → import sans effet de
  bord, testable).
- **Watcher : dirs surveillés = XDG ghostty + Application Support (récursif)**. Un
  `config-file` inclus depuis un chemin HORS de ces dirs ne déclenche pas le reload
  (cas rare, assumé). Si le dossier n'existe pas au lancement, hot-reload off pour la
  session (pas de re-tentative).
- **Frame de sync initiale** : libghostty rapporte la grille fraîche comme dirty au
  premier `update()` → un subscribe sur session vide émet une frame vide. Bénin
  (paint idempotent), mais les tests doivent drainer jusqu'au silence avant les
  assertions négatives (deux tests rendus robustes ainsi).
- **`pnpm lint` à la racine crashe toujours** (OOM oxlint) ; `pnpm exec oxlint src`
  est la commande fiable. Les 2 warnings restants (DiffPanel.snap.test) sont
  préexistants et hors périmètre.

## 2026-06-12 — M12 keybindings Ghostty

- **Actions hors périmètre = fall-through, pas consommation.** Ghostty consomme une
  touche bindée même pour `new_window` ; nous on ne peut pas l'exécuter → la laisser
  passer au PTY/OS vaut mieux qu'une touche morte. Les bindings `unsupported` sont
  filtrés du matcher.
- **Flags `global:`/`all:`/`performable:` parsés mais traités comme bindings normaux**
  (pas de hotkey OS-wide depuis une webview ; `all` n'a pas de sens avec une session
  active unique ; `performable` exigerait de prédire l'exécutabilité avant de
  consommer). À revisiter si besoin réel.
- **Leniency shift sur les symboles** : `super+plus` matche `Meta+'+'` même si le
  layout exige shift pour produire `+`. Ghostty résout via introspection du layout
  clavier (impossible en webview) ; l'égalité du caractère produit est
  l'approximation fidèle. Lettres et touches nommées restent en matching exact.
- **Séquence interrompue = touche avalée** (parité Ghostty) : les touches d'un
  leader cassé ne partent pas au PTY.
- **`clear_screen` = form feed (\f) au shell**, pas de wipe du scrollback (Ghostty
  vide aussi l'historique) — à compléter quand le scrollback arrive (M14).
- **`reset` est terminal-side** (ghostty_terminal_reset) : l'enfant n'est pas
  signalé, comme Ghostty.
- **Paste passe par libghostty** (`ghostty_paste_encode`) : strip des bytes unsafe +
  wrap `ESC[200~` si mode 2004 actif (interrogé en live sur le render thread) —
  jamais d'octets bruts du presse-papier vers le PTY.
- **Font-size keybinds = delta Jotai au-dessus de la config**, le cache bundle reste
  intact (re-mesure locale au pane, `reset_font_size` revient à l'objet caché).
- **Defaults Ghostty seedés dans le fold** (cmd+C/V/A, font-size, cmd+K…) : un
  config vide a les raccourcis standard ; `keybind =` / `clear` les vident, un
  rebind les remplace — sémantique exacte de Ghostty. Sous-ensemble parité (pas les
  actions fenêtre/onglets) ; les binds scroll arrivent avec M14.
- **session_write (brut) ≠ session_paste (encodé)** : `text:`/`esc:` injectent leurs
  octets verbatim ; le paste est toujours encodé. Deux commandes distinctes pour ne
  jamais confondre les chemins.

## 2026-06-12 — Terminal sans Claude + M13/M14/M15

- **Sessions shell ouvertes dans le projet actif uniquement** : `session_create`
  exige un repo git (ref de diff `refs/mizraj/sessions/<id>`). Un terminal hors
  repo échouerait ; non bloquant tant que le projet actif est un repo. À assouplir
  si besoin (sauter la ref pour les sessions shell).
- **Sélection souris** : ordre de flux (stream order), pas rectangulaire — le
  alt+drag rectangulaire de Ghostty n'est pas couvert. Sélection conservée pendant
  l'output (les coordonnées ne suivent pas le scroll du contenu, comme la plupart
  des terminaux canvas). `window-padding-balance` ignoré (cosmétique).
- **copy-on-select** : `selection` et `clipboard` écrivent tous deux le presse-papier
  OS (pas de buffer primaire distinct sur macOS) ; seul `false` désactive.
- **Mode souris app** : décision sélection-vs-forward latchée au mousedown (un flip
  de mode mid-drag ne coupe pas le geste) ; motion dédupliquée par cellule ;
  positions envoyées en CELLULES, encodeur configuré en géométrie 1px=1cellule —
  exact pour X10/UTF-8/SGR/URxvt, SGR-Pixels dégradé à la cellule (rare).
- **Scrollback : déviation contrat** — le plan exigeait une limite en octets dans
  notre ring ; le ring est en réalité celui de libghostty, dont l'option FFI est en
  LIGNES. `scrollback-limit` (octets) ÷ 80 ≈ lignes, clampé [100, 10M]. Une vraie
  comptabilité octets exigerait de posséder le ring (réécriture libghostty) — refusé.
- **Scroll = repaint forcé** : un déplacement de viewport ne « dirty » pas la grille ;
  le render thread force l'émission après `scroll_viewport`. La molette hors mode
  souris descend 3 lignes/cran (multiplicateur Ghostty par défaut).
- **page_up/page_down côté commande** utilisent la hauteur PAR DÉFAUT de la grille
  (le manager ne connaît pas la géométrie live). Les keybinds page passent par là ;
  si l'écart devient visible avec des grilles très hautes, résoudre la page côté
  render thread.
- **DSR/DA** : libghostty génère lui-même les réponses une fois `write_pty` installé ;
  identité DA = VT220 + ANSI color + clipboard (`\\x1b[?62;22;52c`), conforme à l'esprit
  Ghostty. Réponses injectées dans le canal d'input PTY existant (best-effort).
- **Titre OSC 0/2** : poll par burst (1 lecture FFI) plutôt que callback — plus
  simple, même résultat ; broadcast `agent:title` uniquement au changement ; titre
  vide → retour au label dérivé (binaire).

## 2026-06-12 — M16 liens + M17 ligatures

- **OSC8 différé** : la render-state libghostty n'expose qu'un flag
  `has_hyperlink` par cellule, pas l'URI (qui exigerait l'API screen/grid_ref
  complète). M16 livré via détection d'URL par regex sur le texte de ligne
  (http/https/file/mailto, ponctuation finale retirée, mapping colonne↔caractère
  conscient des cellules larges) + survol souligné + cmd-clic via le plugin opener
  officiel. À compléter quand le besoin OSC8 réel se présente.
- **Ligatures : pas de `font-feature-settings` en Canvas2D.** Le shaper du
  navigateur applique les ligatures standard (liga/calt) dès qu'on dessine la
  chaîne entière — c'est exactement ce que fait la passe par runs. Les
  `font-feature` exotiques du config (ss01…) ne sont pas applicables au canvas ;
  limitation documentée, le cas dominant (Fira Code `=>`) fonctionne.
- **Invariant des runs : 1 caractère = 1 colonne.** Glyphes larges et clusters de
  graphèmes dessinent seuls ; les blancs rejoignent un run seulement entre glyphes
  de même style (l'alignement est vérifié arithmétiquement avant la jonction). La
  dérive d'avance fractionnaire vs grille arrondie reste sub-pixel sur des runs
  réalistes ; à surveiller sur très longues lignes uniformes.
- **Sélection dans la passe runs** : les frontières de sélection cassent les runs
  (la couleur de glyphe change) ; la résolution de couleurs est PARTAGÉE
  (`resolveCellColors`) entre passe per-cell et passe runs — zéro divergence
  possible reverse-video/bold-is-bright/sélection.

## Récap des écarts au plan (à lire avant review)

1. **M14 scrollback-limit en lignes** (FFI), pas en octets — ÷80 clampé.
2. **M16 sans transport OSC8** — détection d'URL seulement.
3. **M17 sans font-feature-settings** — ligatures par shaping natif du canvas.
4. **clear_screen ne vide pas le scrollback** (form feed seulement).
5. **Flags keybind global/all/performable** parsés mais sans effet spécifique.
6. **Abonnement frames = bool par session** (pas refcount) — un seul pane par
   session aujourd'hui.
7. **M7.A.05 (hot-reload) réalisé pendant M11** (manquait, prérequis du cache).
