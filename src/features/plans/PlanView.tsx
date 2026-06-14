import type { PlanRoute } from '@/app/router'
import { matchPlanRoute, usePathname } from '@/app/router'
import type { MilestoneGroup } from '@/features/tasks/tasks'
import { useTasks } from '@/features/tasks/tasks'

import { buildPlanDoc } from './planDoc'
import { PlanPaper } from './PlanPaper'
import type { PlanEntry } from './plans'
import { generatedPlanFor } from './plans'
import { useResolvedPlan } from './useResolvedPlan'

const planKey = ({ kind, slug }: PlanRoute): string => `${kind}/${slug}`

const matchingEntry = (
	plans: ReadonlyArray<PlanEntry>,
	route: PlanRoute,
): PlanEntry | null =>
	plans.find(
		entry => entry.kind === route.kind && entry.slug === route.slug,
	) ?? null

type Props = {
	plans: ReadonlyArray<PlanEntry>
	repoPath: string | null
	nowMs: number
}

export const PlanView = ({
	plans,
	repoPath,
	nowMs,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	const route = matchPlanRoute(pathname)
	const resolution = useResolvedPlan(route)
	// TODO: no plan->milestones linkage in backend; tasks_overview is
	// per-project, so the milestones/launch UI reflects the active project
	// regardless of which plan doc is open. Left as-is by review decision.
	const tasks = useTasks(repoPath)

	if (!route) {
		return <p className="pl-doc-empty">Select a plan from the list.</p>
	}
	if (resolution.status === 'loading') {
		return (
			<p className="pl-doc-empty" role="status" aria-live="polite">
				Loading plan…
			</p>
		)
	}
	if (resolution.status === 'error') {
		return (
			<p className="pl-doc-empty" role="alert">
				Plan unavailable: {resolution.message}
			</p>
		)
	}

	const milestones: ReadonlyArray<MilestoneGroup> =
		route.kind === 'plan' && tasks.state.status === 'ready'
			? tasks.state.data.milestones
			: []
	const generatedPlan =
		route.kind === 'interview' ? generatedPlanFor(plans, route.slug) : null

	return (
		<PlanPaper
			key={planKey(route)}
			doc={buildPlanDoc(
				route,
				resolution.url,
				matchingEntry(plans, route),
				nowMs,
			)}
			milestones={milestones}
			generatedPlan={generatedPlan}
			repoPath={repoPath}
		/>
	)
}
