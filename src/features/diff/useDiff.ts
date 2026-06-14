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
const isDiffPayload = (value: unknown): value is DiffPayload =>
	typeof value === 'object' &&
	value !== null &&
	'patch' in value &&
	typeof value.patch === 'string'

const fetchDiff = async (repoPath: string): Promise<DiffPayload> => {
	const payload = await invoke<unknown>('get_diff', { repoPath })
	if (!isDiffPayload(payload)) {
		throw new Error('get_diff returned an unexpected payload')
	}
	return payload
}

// A focus/watcher reload routinely returns the byte-identical patch (nothing
// changed on disk). Skipping the state update on an equal patch keeps the
// `ready` object stable, so usePatchFiles' useMemo([patch]) holds and
// memo(ReviewDiffPane) is never re-diffed for a no-op refresh.
const sameDiff = (previous: DiffPayload, next: DiffPayload): boolean =>
	previous.patch === next.patch

export const useDiff = (repoPath: string | null): DiffResource =>
	useRepoResource(
		repoPath,
		fetchDiff,
		'diff-panel',
		'useDiff: get_diff',
		sameDiff,
	)
