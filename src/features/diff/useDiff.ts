import { invoke } from '@tauri-apps/api/core'

import type { RepoResource } from '@/shared/repoResource'
import { useRepoResource } from '@/shared/repoResource'

type DiffPayload = { patch: string }

export type DiffResource = RepoResource<DiffPayload>

/**
 * The active project's working-tree patch, keyed on `repoPath`: reloads on
 * project switch and window focus (the agent edits out-of-band), and exposes
 * `refetch` for explicit refreshes. The backend resolves the active project
 * itself — `repoPath` is the cache key, not an argument.
 */
const fetchDiff = (): Promise<DiffPayload> => invoke<DiffPayload>('get_diff')

export const useDiff = (repoPath: string | null): DiffResource =>
	useRepoResource(repoPath, fetchDiff, 'diff-panel', 'useDiff: get_diff')
