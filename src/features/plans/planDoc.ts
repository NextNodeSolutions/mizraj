import type { PlanRoute } from '@/app/router'
import type { MilestoneGroup } from '@/features/tasks/tasks'

import type { PlanEntry, PlanKind } from './plans'
import { updatedLabel } from './updatedLabel'

/** What the doc paper renders above the framed document. */
export type PlanDoc = {
	kind: PlanKind
	slug: string
	url: string
	title: string
	meta: string
}

// Plans lead with their slug (date-prefixed, self-describing); interviews
// with their kind — the design's richer strings need linkage the backend
// lacks (see the milestones caveat in PlanPaper).
const metaSubject = ({ kind, slug }: PlanRoute): string =>
	kind === 'plan' ? slug : 'interview'

/**
 * Assemble the doc-paper view model for the routed document. `entry` is the
 * matching list row when the plans list has it — its title and mtime dress
 * the head; without it the slug stands in and the meta drops the age.
 */
export const buildPlanDoc = (
	route: PlanRoute,
	url: string,
	entry: PlanEntry | null,
	nowMs: number,
): PlanDoc => ({
	kind: route.kind,
	slug: route.slug,
	url,
	title: entry === null ? route.slug : entry.title,
	meta:
		entry === null
			? metaSubject(route)
			: `${metaSubject(route)} · ${updatedLabel(nowMs, entry.mtime)}`,
})

/**
 * Extend a doc meta line with what the milestones section will show below —
 * only meaningful when that section renders (plan docs, non-empty overview).
 */
export const appendOverviewCounts = (
	meta: string,
	milestones: ReadonlyArray<MilestoneGroup>,
): string => {
	if (milestones.length === 0) return meta
	const trackCount = milestones.reduce(
		(sum, milestone) => sum + milestone.tracks.length,
		0,
	)
	return `${meta} · ${milestones.length} milestones · ${trackCount} tracks`
}
