# Multi-projet — vision et PRD

Date : 2026-06-13. Source : interview de cadrage (réponses validées point par point).
Statut : décidé. Décline les `TODO(multi-project)` / `TODO(backend)` posés pendant la migration UI v2.

## Vision (points MP — référencés par `slice_of` dans plan.json)

- **MP1 — Parallélisme réel.** Travailler sur N repos à la fois : agents partout, overview
  vraie. PAS N cockpits côte à côte (multi-vue cockpit = « peut-être plus tard »).
- **MP2 — Cockpit mono qui suit la session.** Le Cockpit affiche UN projet :
  agents — terminal — diff, rien d'autre. Sélectionner une session (Mission Control,
  palette, liste) bascule le cockpit sur le projet de cette session ; le picker TopBar
  reste le switch explicite. Les deux coexistent.
- **MP3 — Worktrees nichés.** Hiérarchie repo → worktrees → sessions. Un worktree n'est
  jamais une entrée à part entière de l'overview.
- **MP4 — Hybride auto, zéro gestion.** Un registre de repos, PAS de geste ouvrir/fermer :
  l'UI met devant ce qui vit (sessions, diff non vide, tâches en cours), les repos
  dormants se replient dans une section compacte.
- **MP5 — Overview multi / travail mono.** Mission Control (hub tous repos) et Pipeline
  (kanban cross-projets) sont multi ; Cockpit, Plans, Review restent mono-projet.
- **MP6 — Event-driven obligatoire.** Watchers filesystem par repo (crate `notify`,
  events Tauri débouncés) + push agents. Jamais de polling comme mécanisme principal :
  le futur système de notifications exige un état toujours vrai. (Référence : Orca fait
  pareil — `filesystem-watcher.ts` + event batching.)
- **MP7 — Modulable mais sobre.** Panneaux réarrangeables (grip), modules togglables,
  splitters persistants, code en modules indépendants → à terme plugins (écrans/skills).
  Le minimalisme borne tout : pas de chrome de config, défauts simples.

## Non-goals (ce PRD)

- N cockpits côte à côte, multi-vue terminal.
- Geste ouvrir/fermer des projets (working set explicite façon onglets d'IDE).
- Polling périodique multi-repos.
- Le système de notifications lui-même (MP6 en pose seulement la fondation).
- MP7 (modularité/plugins) — chantier séparé, hors de ces milestones.
- UI worktrees (MP3) — attend que les worktrees existent comme objets backend
  (`worktree.rs` n'expose aucune commande) ; la hiérarchie est actée pour les designs.

## Architecture retenue

- **Registre** : `src-tauri/src/project/registry.rs`, JSON dans le app-data dir Tauri ;
  `set_active_project` auto-enregistre. Commandes `projects_list/add/remove`.
- **Lectures par repo** : `get_diff`, `tasks_overview`, `repo_head` prennent `repo_path`
  en argument ; le « projet actif » devient une préférence UI, plus un état serveur.
  Attention : la pool SQLite des tasks est scopée au projet actif aujourd'hui → pool
  par repo.
- **Watchers** : un par repo du registre, watch `.git/HEAD`, `.git/refs/`, worktree ;
  debounce/batch ; event Tauri `repo-changed { repoPath, kind }` ; le front invalide
  ses queries sur event.

## Chantiers → milestones (plan.json)

| Milestone                           | Branch                                                    | Dépend   | Démo                                                          |
| ----------------------------------- | --------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| M18 registre                        | `feat/project-registry`                                   | —        | picker dropdown + repos dormants repliés dans Mission Control |
| M19 lectures par repo               | `feat/repo-scoped-reads`                                  | M18      | branche + diff par carte, 2 repos à la fois, zéro mutation    |
| M20 watchers FS                     | `feat/fs-watchers`                                        | M19      | commit externe → stats à jour < 1 s, rebase débouncé          |
| M21 cockpit-follow + pipeline multi | `feat/cockpit-follow-session`, `feat/pipeline-multi-repo` | M18, M19 | clic session repo B → cockpit B ; pipeline groupé par repo    |

## TODOs de code résolus par ces milestones

- `src/features/missionControl/projectGroups.ts:24` (registre) → M18.
- `src/features/projects/ProjectPicker.tsx:20` (scope all projects) → M18 + M21.
- `src/features/missionControl/AgentCard.tsx:26/152/162` (review cross-projet, branche
  et diff par carte) → M19.
- `src/features/pipeline/PipelineView.tsx:25` (diff par session) → M19 pose la lecture
  par repo ; l'attribution par session reste liée au futur mapping session→branche.
