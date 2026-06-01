import PlanTree from './PlanTree'
import type { Overview } from './tasks'
import UserTaskList from './UserTaskList'

type TasksContentProps = {
	overview: Overview
	onChanged: () => void
}

const TasksContent = ({
	overview,
	onChanged,
}: TasksContentProps): React.JSX.Element => (
	<>
		<PlanTree milestones={overview.milestones} onChanged={onChanged} />
		<UserTaskList tasks={overview.userTasks} onChanged={onChanged} />
	</>
)

export default TasksContent
