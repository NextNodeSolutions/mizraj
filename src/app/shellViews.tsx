import {
	IconBoard,
	IconDiff,
	IconDoc,
	IconGrid,
	IconTerm,
} from '@/shared/ui/icons'

import {
	matchAgentRunIndexRoute,
	matchAgentRunRoute,
	matchMissionControlRoute,
	matchPipelineRoute,
	matchPlanRoute,
	matchPlansIndexRoute,
	matchReviewRoute,
	missionControlHref,
	pipelineHref,
	plansIndexHref,
	reviewHref,
} from './router'

export type ShellViewId =
	| 'mission'
	| 'cockpit'
	| 'pipeline'
	| 'plans'
	| 'review'

export type ShellView = {
	id: ShellViewId
	label: string
	icon: React.JSX.Element
	href: string
	isActive: (pathname: string) => boolean
}

/**
 * The ordered shell views — the single source behind both the rail buttons and
 * the ⌘1..N chords, so the chord index and the rail order can never drift (the
 * ARCH5 cross-cutting namespace). The cockpit href follows the active session,
 * so the list is built per render from it. The tasks route is palette-only and
 * deliberately absent (no rail entry, no chord).
 */
export const shellViews = (cockpitHref: string): ReadonlyArray<ShellView> => [
	{
		id: 'mission',
		label: 'Agents',
		icon: <IconGrid />,
		href: missionControlHref(),
		isActive: matchMissionControlRoute,
	},
	{
		id: 'cockpit',
		label: 'Cockpit',
		icon: <IconTerm />,
		href: cockpitHref,
		isActive: pathname =>
			matchAgentRunRoute(pathname) !== null ||
			matchAgentRunIndexRoute(pathname),
	},
	{
		id: 'pipeline',
		label: 'Board',
		icon: <IconBoard />,
		href: pipelineHref(),
		isActive: matchPipelineRoute,
	},
	{
		id: 'plans',
		label: 'Plans',
		icon: <IconDoc />,
		href: plansIndexHref(),
		isActive: pathname =>
			matchPlansIndexRoute(pathname) || matchPlanRoute(pathname) !== null,
	},
	{
		id: 'review',
		label: 'Review',
		icon: <IconDiff />,
		href: reviewHref(),
		isActive: matchReviewRoute,
	},
]
