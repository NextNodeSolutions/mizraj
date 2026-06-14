import { useDiff } from '@/features/diff/useDiff'
import { repoHeadLabel, useRepoHead } from '@/features/projects/repoHead'
import type { DiffTotals } from '@/features/review/reviewFiles'
import { diffTotals, reviewFilesFromPatch } from '@/features/review/reviewFiles'

export type RepoStats = {
	/** The repo's checked-out branch label, when HEAD has resolved. */
	branch: string | null
	/** The repo's working-tree +/- totals, when the diff has resolved. */
	totals: DiffTotals | null
}

/**
 * One HEAD + one working-tree read for a repo (MP1): the branch label and the
 * +/- totals of the repo's OWN working tree, never the active project's. The
 * orchestration that ProjectGroup used to inline.
 */
export const useRepoStats = (repoPath: string | null): RepoStats => {
	const head = useRepoHead(repoPath)
	const diff = useDiff(repoPath)
	const branch = head.status === 'ready' ? repoHeadLabel(head.data) : null
	const totals =
		diff.state.status === 'ready'
			? diffTotals(reviewFilesFromPatch(diff.state.data.patch))
			: null
	return { branch, totals }
}
