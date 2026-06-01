import type { Task } from '../lib/tasks'
import { TASK_STATUSES } from '../lib/tasks'

import TaskGroup from './TaskGroup'

type TaskListProps = {
	tasks: ReadonlyArray<Task>
	onChanged: () => void
}

const TaskList = ({ tasks, onChanged }: TaskListProps): React.JSX.Element => {
	if (tasks.length === 0) {
		return (
			<p className="tasks-view__empty">No tasks for this project yet.</p>
		)
	}
	return (
		<>
			{TASK_STATUSES.map(status => {
				const group = tasks.filter(task => task.status === status)
				return group.length === 0 ? null : (
					<TaskGroup
						key={status}
						status={status}
						tasks={group}
						onChanged={onChanged}
					/>
				)
			})}
		</>
	)
}

export default TaskList
