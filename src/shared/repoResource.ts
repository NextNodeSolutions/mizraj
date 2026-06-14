import { useCallback, useEffect, useRef, useState } from 'react'

import { onRepoChanged } from '@/features/projects/repoEvents'

import { onAppFocus } from './appFocus'
import { describeError } from './errors'
import { logger } from './logger'

/**
 * A repo-scoped async resource: `idle` until a repo is selected, then
 * `loading` → `ready`/`error`. Reloads on window focus so the view reflects
 * out-of-band changes (a `/next` run, a manual edit) without an explicit
 * refresh, and exposes `refetch` for callers that just mutated the resource
 * (e.g. created a task) and want the new state immediately.
 */
export type ResourceState<T> =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; data: T }
	| { status: 'error'; message: string }

export type RepoResource<T> = {
	state: ResourceState<T>
	refetch: () => void
}

export const useRepoResource = <T>(
	repoPath: string | null,
	fetcher: (repoPath: string) => Promise<T>,
	scope: string,
	label: string,
	// Optional identity test. When a focus/watcher reload yields data this
	// deems equal to the last applied value, the state is left untouched so the
	// `ready` object keeps its reference — downstream memo (re-parse, re-diff)
	// then skips a no-op refresh instead of re-running on every window focus.
	isEqual?: (previous: T, next: T) => boolean,
): RepoResource<T> => {
	const [state, setState] = useState<ResourceState<T>>({ status: 'idle' })
	// Monotonic token so overlapping reloads (mount, focus, refetch) never let a
	// slower one clobber a newer one — only the latest request applies its result.
	const requestRef = useRef(0)
	// The last applied `ready` data, for the isEqual short-circuit. Reset
	// whenever the resource leaves `ready` (repo switch, idle, error) so a stale
	// value from a previous repo can never suppress the next load's first apply.
	const dataRef = useRef<T | null>(null)

	const reload = useCallback(async (): Promise<void> => {
		if (repoPath === null) return
		const request = (requestRef.current += 1)
		try {
			const data = await fetcher(repoPath)
			if (request !== requestRef.current) return
			if (
				isEqual !== undefined &&
				dataRef.current !== null &&
				isEqual(dataRef.current, data)
			) {
				return
			}
			dataRef.current = data
			setState({ status: 'ready', data })
		} catch (error: unknown) {
			const { message, stack } = describeError(error)
			logger.error(`${label} failed: ${message}`, {
				scope,
				details: { stack, repoPath },
			})
			if (request === requestRef.current) {
				dataRef.current = null
				setState({ status: 'error', message })
			}
		}
	}, [repoPath, fetcher, scope, label, isEqual])

	useEffect(() => {
		if (repoPath === null) {
			requestRef.current += 1
			dataRef.current = null
			setState({ status: 'idle' })
			return
		}

		dataRef.current = null
		setState({ status: 'loading' })
		void reload()

		// Both subscriptions resolve to synchronous unsubscribes (in-memory
		// registry removals), so cleanup never calls Tauri's `unlisten()` — see
		// appFocus.ts / repoEvents.ts for why that matters under StrictMode.
		const offFocus = onAppFocus(() => void reload())
		// Event-driven refresh (MP6): the backend watcher reports this repo's
		// filesystem changes; only this repo's resources refetch on them.
		const offRepoChanged = onRepoChanged(repoPath, () => void reload())

		return () => {
			offFocus()
			offRepoChanged()
		}
	}, [repoPath, reload])

	return { state, refetch: reload }
}
