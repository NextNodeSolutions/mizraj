import { TaskItem } from './TaskItem'
import type { Task, TaskStatus } from './tasks'
import { STATUS_CONFIG } from './taskStatusConfig'

type GroupProps = {
	status: TaskStatus
	tasks: ReadonlyArray<Task>
	onChanged: () => void
}

export const TaskGroup = ({
	status,
	tasks,
	onChanged,
}: GroupProps): React.JSX.Element => (
	<section className="tasks-view__group">
		<h3 className="tasks-view__heading">
			{STATUS_CONFIG[status].label}{' '}
			<span className="tasks-view__count">{tasks.length}</span>
		</h3>
		<ul className="tasks-view__list">
			{tasks.map(task => (
				<TaskItem key={task.id} task={task} onChanged={onChanged} />
			))}
		</ul>
	</section>
)
