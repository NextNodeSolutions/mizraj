import { useMemo } from 'react'

import { useDiff } from '@/features/diff/useDiff'

import type { DiffTotals } from './reviewFiles'
import { diffTotals, reviewFilesFromPatch } from './reviewFiles'

/**
 * A repo's own working-tree +/- totals (MP5) — the same diff the Review screen
 * opens for it, never the active project's. Repo-diff logic, shared by the
 * pipeline cards rather than inlined in them.
 *
 * TODO: per-session diff stats — needs a session/branch-scoped diff command
 * (mizraj_vcs::diff_session exists in the crate but is not exposed as a Tauri
 * command).
 */
export const useWorkingTreeTotals = (
	repoPath: string | null,
): DiffTotals | null => {
	const { state } = useDiff(repoPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	return useMemo(
		() => (patch === null ? null : diffTotals(reviewFilesFromPatch(patch))),
		[patch],
	)
}
