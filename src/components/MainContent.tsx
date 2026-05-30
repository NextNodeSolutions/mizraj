import { matchAgentRunRoute, matchTasksRoute, usePathname } from '../router'
import AgentRun from '../views/AgentRun'
import PlanView from '../views/PlanView'
import TasksView from '../views/TasksView'

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
