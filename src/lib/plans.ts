import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export type PlanKind = 'interview' | 'plan'

export type PlanEntry = {
	kind: PlanKind
	slug: string
	title: string
	path: string
	mtime: number
}

export type PlansState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; entries: ReadonlyArray<PlanEntry> }
	| { status: 'error'; message: string }

const fetchPlans = async (repoPath: string): Promise<PlanEntry[]> =>
	invoke<PlanEntry[]>('list_plans', { repoPath })

export const usePlans = (repoPath: string | null): PlansState => {
	const [state, setState] = useState<PlansState>({ status: 'idle' })

	useEffect(() => {
		if (repoPath === null) {
			setState({ status: 'idle' })
			return
		}
		let cancelled = false
		setState({ status: 'loading' })
		void fetchPlans(repoPath)
			.then(entries => {
				if (!cancelled) {
					setState({ status: 'ready', entries })
				}
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`usePlans: failed to list plans: ${message}`, {
					scope: 'plans-menu',
					details: { stack, repoPath },
				})
				if (!cancelled) {
					setState({ status: 'error', message })
				}
			})
		return () => {
			cancelled = true
		}
	}, [repoPath])

	return state
}
