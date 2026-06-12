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

type RouteId = 'mission' | 'cockpit' | 'pipeline' | 'plans' | 'review' | 'tasks'

// The .mz-view wrapper is keyed by this id: switching screens remounts it
// and replays the viewIn entrance, while a param-only change (another
// session in the cockpit, another plan document) keeps the same container.
const routeIdFor = (pathname: string): RouteId => {
	if (matchMissionControlRoute(pathname)) return 'mission'
	if (
		matchAgentRunRoute(pathname) !== null ||
		matchAgentRunIndexRoute(pathname)
	) {
		return 'cockpit'
	}
	if (matchPipelineRoute(pathname)) return 'pipeline'
	if (matchReviewRoute(pathname)) return 'review'
	if (matchTasksRoute(pathname)) return 'tasks'
	return 'plans'
}

type ScreenProps = {
	pathname: string
	activeProjectPath: string | null
}

const RoutedScreen = ({
	pathname,
	activeProjectPath,
}: ScreenProps): React.JSX.Element => {
	if (matchMissionControlRoute(pathname)) {
		return <MissionControl activeProjectPath={activeProjectPath} />
	}
	const agentRunRoute = matchAgentRunRoute(pathname)
	if (agentRunRoute) {
		return (
			<AgentRun
				key={agentRunRoute.sessionId}
				sessionId={agentRunRoute.sessionId}
				activeProjectPath={activeProjectPath}
			/>
		)
	}
	if (matchAgentRunIndexRoute(pathname)) {
		// Placeholder for the no-session cockpit; restyled in phase B.
		return (
			<p className="cockpit-empty">
				No session yet — launch an agent or open a terminal.
			</p>
		)
	}
	if (matchPipelineRoute(pathname)) {
		return <PipelineView activeProjectPath={activeProjectPath} />
	}
	if (matchReviewRoute(pathname)) {
		return <ReviewView activeProjectPath={activeProjectPath} />
	}
	if (matchTasksRoute(pathname)) {
		return <TasksView repoPath={activeProjectPath} />
	}
	// Plans deep links and the bare /plans index both land here.
	return <PlansView activeProjectPath={activeProjectPath} />
}

type Props = {
	activeProjectPath: string | null
}

export const MainContent = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	return (
		<main className="mz-views">
			<div className="mz-view" data-state="in" key={routeIdFor(pathname)}>
				<RoutedScreen
					pathname={pathname}
					activeProjectPath={activeProjectPath}
				/>
			</div>
		</main>
	)
}
