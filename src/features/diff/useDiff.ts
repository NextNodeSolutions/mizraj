import { invoke } from '@tauri-apps/api/core'

import type { RepoResource } from '@/shared/repoResource'
import { useRepoResource } from '@/shared/repoResource'

type DiffPayload = { patch: string }

export type DiffResource = RepoResource<DiffPayload>

/**
 * `repoPath`'s working-tree patch: reloads on repo change and window focus
 * (the agent edits out-of-band), and exposes `refetch` for explicit
 * refreshes. The path is passed to the backend — any registered repo can be
 * read without touching the active-project preference (MP1).
 */
const fetchDiff = (repoPath: string): Promise<DiffPayload> =>
	invoke<DiffPayload>('get_diff', { repoPath })

export const useDiff = (repoPath: string | null): DiffResource =>
	useRepoResource(repoPath, fetchDiff, 'diff-panel', 'useDiff: get_diff')
