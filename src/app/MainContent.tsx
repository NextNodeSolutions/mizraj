import { MissionControl } from '@/features/missionControl/MissionControl'
import { PlanView } from '@/features/plans/PlanView'
import { AgentRun } from '@/features/sessions/AgentRun'
import { TasksView } from '@/features/tasks/TasksView'

import {
	matchAgentRunRoute,
	matchMissionControlRoute,
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
	if (matchTasksRoute(pathname)) {
		return <TasksView repoPath={activeProjectPath} />
	}
	return <PlanView />
}
