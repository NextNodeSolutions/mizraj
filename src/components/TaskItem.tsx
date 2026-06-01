import type { Task } from '../lib/tasks'

import StatusSelect from './StatusSelect'
import { STATUS_CONFIG } from './taskStatusConfig'

type ItemProps = {
	task: Task
	onChanged: () => void
}

const TaskItem = ({ task, onChanged }: ItemProps): React.JSX.Element => (
	<li className={`tasks-view__item tasks-view__item--${task.status}`}>
		<span className="tasks-view__marker" aria-hidden="true">
			{STATUS_CONFIG[task.status].marker}
		</span>
		<div className="tasks-view__body">
			<span className="tasks-view__title">{task.title}</span>
			{task.description !== null && task.description !== '' && (
				<span className="tasks-view__description">
					{task.description}
				</span>
			)}
		</div>
		{task.origin === 'user' ? (
			<StatusSelect task={task} onChanged={onChanged} />
		) : (
			<span className="tasks-view__origin">track</span>
		)}
	</li>
)

export default TaskItem
