import { MissionControl } from '@/features/missionControl/MissionControl'
import { PipelineView } from '@/features/pipeline/PipelineView'
import { PlansView } from '@/features/plans/PlansView'
import { ReviewView } from '@/features/review/ReviewView'
import { AgentRun } from '@/features/sessions/AgentRun'
import { TasksView } from '@/features/tasks/TasksView'

import {
	matchAgentRunIndexRoute,
	matchAgentRunRoute,
	matchMissionControlRoute,
	matchPipelineRoute,
	matchReviewRoute,
	matchTasksRoute,
	usePathname,
} from './router'

// The .mz-view wrapper is keyed by `id`: switching screens (a new id) remounts
// it and replays the viewIn entrance, while a param-only change (another
// session in the cockpit, another plan document) keeps the same id and the same
// container. Two cockpit rows share the 'cockpit' id on purpose.
type RouteId = 'mission' | 'cockpit' | 'pipeline' | 'plans' | 'review' | 'tasks'

type ScreenProps = {
	pathname: string
	activeProjectPath: string | null
}

type RouteDef = {
	id: RouteId
	match: (pathname: string) => boolean
	render: (props: ScreenProps) => React.JSX.Element
}

// One ordered table: the id (for the view key) and the screen are decided from
// the same matched entry, so a new view is one row — not two parallel switches.
const ROUTES: ReadonlyArray<RouteDef> = [
	{
		id: 'mission',
		match: matchMissionControlRoute,
		render: ({ activeProjectPath }) => (
			<MissionControl activeProjectPath={activeProjectPath} />
		),
	},
	{
		id: 'cockpit',
		match: pathname => matchAgentRunRoute(pathname) !== null,
		render: ({ pathname, activeProjectPath }) => {
			const route = matchAgentRunRoute(pathname)
			if (route === null) return <></>
			return (
				<AgentRun
					key={route.sessionId}
					sessionId={route.sessionId}
					activeProjectPath={activeProjectPath}
				/>
			)
		},
	},
	{
		id: 'cockpit',
		match: matchAgentRunIndexRoute,
		render: () => (
			<div className="fc-empty">
				<p>No session yet — launch an agent or open a terminal.</p>
			</div>
		),
	},
	{
		id: 'pipeline',
		match: matchPipelineRoute,
		render: ({ activeProjectPath }) => (
			<PipelineView activeProjectPath={activeProjectPath} />
		),
	},
	{
		id: 'review',
		match: matchReviewRoute,
		render: ({ activeProjectPath }) => (
			<ReviewView activeProjectPath={activeProjectPath} />
		),
	},
	{
		id: 'tasks',
		match: matchTasksRoute,
		render: ({ activeProjectPath }) => (
			<TasksView repoPath={activeProjectPath} />
		),
	},
]

// Plans deep links and the bare /plans index both land here.
const FALLBACK_ROUTE: RouteDef = {
	id: 'plans',
	match: () => true,
	render: ({ activeProjectPath }) => (
		<PlansView activeProjectPath={activeProjectPath} />
	),
}

const routeFor = (pathname: string): RouteDef =>
	ROUTES.find(route => route.match(pathname)) ?? FALLBACK_ROUTE

type Props = {
	activeProjectPath: string | null
}

export const MainContent = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	const route = routeFor(pathname)
	return (
		<main className="mz-views">
			<div className="mz-view" data-state="in" key={route.id}>
				{route.render({ pathname, activeProjectPath })}
			</div>
		</main>
	)
}
