import { useCockpitTargetHref } from '@/features/sessions/cockpitTarget'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { useSessions } from '@/features/sessions/useSessions'
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
	navigate,
	pipelineHref,
	plansIndexHref,
	reviewHref,
	usePathname,
} from './router'

type RailItem = {
	label: string
	icon: React.JSX.Element
	href: string
	isActive: (pathname: string) => boolean
	badge?: number
}

// The tasks route keeps no rail entry (palette only), matching the design.
const railItems = (
	cockpitHref: string,
	reviewCount: number,
): ReadonlyArray<RailItem> => [
	{
		label: 'Agents',
		icon: <IconGrid />,
		href: missionControlHref(),
		isActive: matchMissionControlRoute,
	},
	{
		label: 'Cockpit',
		icon: <IconTerm />,
		href: cockpitHref,
		isActive: pathname =>
			matchAgentRunRoute(pathname) !== null ||
			matchAgentRunIndexRoute(pathname),
	},
	{
		label: 'Board',
		icon: <IconBoard />,
		href: pipelineHref(),
		isActive: matchPipelineRoute,
	},
	{
		label: 'Plans',
		icon: <IconDoc />,
		href: plansIndexHref(),
		isActive: pathname =>
			matchPlansIndexRoute(pathname) || matchPlanRoute(pathname) !== null,
	},
	{
		label: 'Review',
		icon: <IconDiff />,
		href: reviewHref(),
		isActive: matchReviewRoute,
		badge: reviewCount,
	},
]

export const Rail = (): React.JSX.Element => {
	const pathname = usePathname()
	const cockpitHref = useCockpitTargetHref()
	const sessions = useSessions()
	const reviewCount = sessions.filter(
		session => sessionDisplayStatus(session) === 'review',
	).length

	return (
		<nav className="mz-rail" aria-label="Views">
			{railItems(cockpitHref, reviewCount).map(item => (
				<button
					key={item.label}
					type="button"
					className="mz-railbtn"
					data-on={item.isActive(pathname) ? 'true' : 'false'}
					aria-label={item.label}
					onClick={() => navigate(item.href)}
				>
					{item.badge !== undefined && item.badge > 0 && (
						<span className="rail-badge">{item.badge}</span>
					)}
					{item.icon}
					<span className="rl">{item.label}</span>
				</button>
			))}
		</nav>
	)
}
