import { invoke } from '@tauri-apps/api/core'

import type { ResourceState } from '@/shared/repoResource'
import { useRepoResource } from '@/shared/repoResource'

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

/**
 * The plan an interview produced, when one is listed.
 */
// TODO: interview->plan linkage missing; using slug-suffix heuristic (plan
// '2026-05-15-mizraj' matches interview 'mizraj') until the backend exposes the
// generated plan id
export const generatedPlanFor = (
	plans: ReadonlyArray<PlanEntry>,
	interviewSlug: string,
): PlanEntry | null =>
	plans.find(
		entry => entry.kind === 'plan' && entry.slug.endsWith(interviewSlug),
	) ?? null
