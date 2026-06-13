import { useCallback, useEffect, useRef, useState } from 'react'

import { onRepoChanged } from '@/features/projects/repoEvents'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { Overview } from './tasks'
import { fetchOverview } from './tasks'

export type OverviewsApi = {
	/** One overview per readable repo, in registry order; failures skipped. */
	overviews: ReadonlyArray<Overview>
	refetch: () => void
}

const loadAll = async (
	repoPaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<Overview>> => {
	const settled = await Promise.allSettled(repoPaths.map(fetchOverview))
	return settled.flatMap((result, index) => {
		if (result.status === 'fulfilled') return [result.value]
		const { message } = describeError(result.reason)
		logger.error(`useOverviews: tasks_overview failed: ${message}`, {
			scope: 'pipeline',
			details: { repoPath: repoPaths[index] },
		})
		return []
	})
}

/**
 * The task overviews of every given repo at once (MP5: multi-repo piloting
 * screens read the registry, not the active project). A repo that cannot be
 * read is logged and skipped — the board shows the truth it has. Each repo's
 * `repo-changed` events refetch the whole set.
 */
export const useOverviews = (
	repoPaths: ReadonlyArray<string>,
): OverviewsApi => {
	const [overviews, setOverviews] = useState<ReadonlyArray<Overview>>([])
	const requestRef = useRef(0)
	// Key the effect on contents, not array identity — callers pass fresh
	// arrays every render.
	const reposKey = repoPaths.join('\n')

	const reload = useCallback(async (): Promise<void> => {
		const repos = reposKey === '' ? [] : reposKey.split('\n')
		const request = (requestRef.current += 1)
		const loaded = repos.length === 0 ? [] : await loadAll(repos)
		if (request === requestRef.current) setOverviews(loaded)
	}, [reposKey])

	useEffect(() => {
		void reload()
		const repos = reposKey === '' ? [] : reposKey.split('\n')
		const unsubscribes = repos.map(repo =>
			onRepoChanged(repo, () => void reload()),
		)
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe()
		}
	}, [reposKey, reload])

	return { overviews, refetch: () => void reload() }
}
