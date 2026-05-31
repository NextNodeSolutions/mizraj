import { invoke } from '@tauri-apps/api/core'

import { useRepoResource } from './repoResource'

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
	const state = useRepoResource(
		repoPath,
		fetchPlans,
		'plans-menu',
		'usePlans: list_plans',
	)
	return state.status === 'ready'
		? { status: 'ready', entries: state.data }
		: state
}
