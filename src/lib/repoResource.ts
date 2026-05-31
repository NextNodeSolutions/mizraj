import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

/**
 * A repo-scoped async resource: `idle` until a repo is selected, then
 * `loading` → `ready`/`error`. Reloads on window focus so the view reflects
 * out-of-band changes (a `/next` run, a manual edit) without an explicit
 * refresh.
 */
export type ResourceState<T> =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; data: T }
	| { status: 'error'; message: string }

export const useRepoResource = <T>(
	repoPath: string | null,
	fetcher: (repoPath: string) => Promise<T>,
	scope: string,
	label: string,
): ResourceState<T> => {
	const [state, setState] = useState<ResourceState<T>>({ status: 'idle' })

	useEffect(() => {
		if (repoPath === null) {
			setState({ status: 'idle' })
			return
		}

		let cancelled = false

		const reload = async (): Promise<void> => {
			try {
				const data = await fetcher(repoPath)
				if (!cancelled) setState({ status: 'ready', data })
			} catch (error: unknown) {
				const { message, stack } = describeError(error)
				logger.error(`${label} failed: ${message}`, {
					scope,
					details: { stack, repoPath },
				})
				if (!cancelled) setState({ status: 'error', message })
			}
		}

		setState({ status: 'loading' })
		void reload()

		const unlistenPromise = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (focused) void reload()
			},
		)

		return () => {
			cancelled = true
			void unlistenPromise.then(off => off())
		}
	}, [repoPath, fetcher, scope, label])

	return state
}
