import type { Task } from '../lib/tasks'
import { TASK_STATUSES } from '../lib/tasks'

import TaskGroup from './TaskGroup'

type UserTaskListProps = {
	tasks: ReadonlyArray<Task>
	onChanged: () => void
}

const UserTaskList = ({
	tasks,
	onChanged,
}: UserTaskListProps): React.JSX.Element => {
	if (tasks.length === 0) {
		return <p className="tasks-view__empty">No user tasks yet.</p>
	}
	return (
		<div className="tasks-view__user-tasks" aria-label="User tasks">
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
		</div>
	)
}

export default UserTaskList
