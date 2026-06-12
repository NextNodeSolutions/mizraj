import { MissionControl } from '@/features/missionControl/MissionControl'
import { PlanView } from '@/features/plans/PlanView'
import { ReviewView } from '@/features/review/ReviewView'
import { AgentRun } from '@/features/sessions/AgentRun'
import { TasksView } from '@/features/tasks/TasksView'

import {
	matchAgentRunRoute,
	matchMissionControlRoute,
	matchReviewRoute,
	matchTasksRoute,
	usePathname,
} from './router'

type Props = {
	activeProjectPath: string | null
}

export const MainContent = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	if (matchMissionControlRoute(pathname)) {
		return <MissionControl activeProjectPath={activeProjectPath} />
	}
	const agentRunRoute = matchAgentRunRoute(pathname)
	if (agentRunRoute) {
		return (
			<AgentRun
				key={agentRunRoute.sessionId}
				sessionId={agentRunRoute.sessionId}
			/>
		)
	}
	if (matchReviewRoute(pathname)) {
		return <ReviewView activeProjectPath={activeProjectPath} />
	}
	if (matchTasksRoute(pathname)) {
		return <TasksView repoPath={activeProjectPath} />
	}
	return <PlanView />
}
