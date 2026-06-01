import PlanView from '@/features/plans/PlanView'
import AgentRun from '@/features/sessions/AgentRun'
import TasksView from '@/features/tasks/TasksView'

import { matchAgentRunRoute, matchTasksRoute, usePathname } from './router'

type Props = {
	activeProjectPath: string | null
}

const MainContent = ({ activeProjectPath }: Props): React.JSX.Element => {
	const pathname = usePathname()
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

export default MainContent
