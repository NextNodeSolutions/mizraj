# M1.A — agent-cockpit

Started: 2026-05-29T17:27:53Z
Plan: /Users/walid-mos/Development/nextnode/agent-cockpit/docs/plans/agent-cockpit/plan.json
Slug: agent-cockpit
Milestone: M1 — L'app packagée v0.1.0 lance un agent, on peut le stopper, choisir le repo via un picker, et le diff s'ouvre seul en fin de run — release GitHub avec binaires.

## Helpers

- Next task (LLM does it): `/next` — commits + pushes the previous `[~]` task
  (now validated), then starts the next `[ ]`.
- Linear adapter (only for tasks with a `sink_id`):
  `python3 ~/.stow_repository/claude/.claude/skills/next/set_state.py <sink_id> started`
- Commit format used at validation time: `<type>(<scope>): <imperative title>`;
  if the task has a `sink_id`, the body ends with `Closes <sink_id>`. The commit
  is created at the START of the *next* `/next` run, never at the end of the
  current one — so you review the working-tree diff first.
- This track = ONE PR. When the last task is shipped, open it with `/pr`.

## Tasks

- [x] [M1.A-01] Revert la migration 0004_diff_comments - 6f2df4f
- [x] [M1.A-02] Stopper un run depuis l'UI - 55b7d62
- [x] [M1.A-03] Choisir le repo via un project picker - fdea85f
- [x] [M1.A-04] Ouvrir le diff automatiquement en fin de run - 3f809ba
- [x] [M1.A-05] Taguer la release v0.1.0 - 66fb900
