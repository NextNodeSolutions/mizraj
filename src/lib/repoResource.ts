import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

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
): RepoResource<T> => {
	const [state, setState] = useState<ResourceState<T>>({ status: 'idle' })
	// Monotonic token so overlapping reloads (mount, focus, refetch) never let a
	// slower one clobber a newer one — only the latest request applies its result.
	const requestRef = useRef(0)

	const reload = useCallback(async (): Promise<void> => {
		if (repoPath === null) return
		const request = (requestRef.current += 1)
		try {
			const data = await fetcher(repoPath)
			if (request === requestRef.current) {
				setState({ status: 'ready', data })
			}
		} catch (error: unknown) {
			const { message, stack } = describeError(error)
			logger.error(`${label} failed: ${message}`, {
				scope,
				details: { stack, repoPath },
			})
			if (request === requestRef.current) {
				setState({ status: 'error', message })
			}
		}
	}, [repoPath, fetcher, scope, label])

	useEffect(() => {
		if (repoPath === null) {
			requestRef.current += 1
			setState({ status: 'idle' })
			return
		}

		setState({ status: 'loading' })
		void reload()

		const unlistenPromise = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (focused) void reload()
			},
		)

		return () => {
			void unlistenPromise.then(off => off())
		}
	}, [repoPath, reload])

	return { state, refetch: reload }
}
