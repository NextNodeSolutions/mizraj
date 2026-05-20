import { invoke } from '@tauri-apps/api/core'
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

const setActiveProject = async (repoPath: string): Promise<void> =>
	invoke('set_active_project', { repoPath })

const fetchPlans = async (): Promise<PlanEntry[]> => invoke<PlanEntry[]>('list_plans')

export const usePlans = (repoPath: string | null): PlansState => {
	const [state, setState] = useState<PlansState>({ status: 'idle' })

	useEffect(() => {
		if (repoPath === null) {
			setState({ status: 'idle' })
			return
		}
		let cancelled = false
		setState({ status: 'loading' })
		void (async () => {
			try {
				await setActiveProject(repoPath)
				if (cancelled) return
				const entries = await fetchPlans()
				if (cancelled) return
				setState({ status: 'ready', entries })
			} catch (error: unknown) {
				const { message, stack } = describeError(error)
				logger.error(`usePlans: failed to list plans: ${message}`, {
					scope: 'plans-menu',
					details: { stack, repoPath },
				})
				if (!cancelled) {
					setState({ status: 'error', message })
				}
			}
		})()
		return () => {
			cancelled = true
		}
	}, [repoPath])

	return state
}
