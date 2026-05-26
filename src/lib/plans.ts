import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export const PLAN_KINDS = ['interview', 'plan'] as const
export type PlanKind = (typeof PLAN_KINDS)[number]

export type PlanEntry = {
	kind: PlanKind
	slug: string
	title: string
	url: string
	mtime: number
}

export type PlansState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; entries: ReadonlyArray<PlanEntry> }
	| { status: 'error'; message: string }

const fetchPlans = (repoPath: string): Promise<PlanEntry[]> =>
	invoke<PlanEntry[]>('list_plans', { repoPath })

export const usePlans = (repoPath: string | null): PlansState => {
	const [state, setState] = useState<PlansState>({ status: 'idle' })

	useEffect(() => {
		if (repoPath === null) {
			setState({ status: 'idle' })
			return
		}

		let cancelled = false

		const reload = async (): Promise<void> => {
			try {
				const entries = await fetchPlans(repoPath)
				if (!cancelled) setState({ status: 'ready', entries })
			} catch (error: unknown) {
				const { message, stack } = describeError(error)
				logger.error(`usePlans: list_plans failed: ${message}`, {
					scope: 'plans-menu',
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
	}, [repoPath])

	return state
}
