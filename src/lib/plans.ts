import { invoke } from '@tauri-apps/api/core'

import type { ResourceState } from './repoResource'
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

export type PlansState = ResourceState<ReadonlyArray<PlanEntry>>

const fetchPlans = (repoPath: string): Promise<ReadonlyArray<PlanEntry>> =>
	invoke<PlanEntry[]>('list_plans', { repoPath })

export const usePlans = (repoPath: string | null): PlansState =>
	useRepoResource(repoPath, fetchPlans, 'plans-menu', 'usePlans: list_plans')
		.state
