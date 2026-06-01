import { useState } from 'react'

import type { Task } from '../lib/tasks'

import StatusSelect from './StatusSelect'
import TaskEditor from './TaskEditor'
import { STATUS_CONFIG } from './taskStatusConfig'

type ItemProps = {
	task: Task
	onChanged: () => void
}

const TaskItem = ({ task, onChanged }: ItemProps): React.JSX.Element => {
	const [editing, setEditing] = useState(false)
	const isEditable = task.origin === 'user'
	const hasDescription = task.description !== null && task.description !== ''

	const handleSaved = (): void => {
		setEditing(false)
		onChanged()
	}

	return (
		<li className={`tasks-view__item tasks-view__item--${task.status}`}>
			<span className="tasks-view__marker" aria-hidden="true">
				{STATUS_CONFIG[task.status].marker}
			</span>
			{editing ? (
				<TaskEditor
					task={task}
					onSaved={handleSaved}
					onCancel={() => setEditing(false)}
				/>
			) : (
				<>
					<div className="tasks-view__body">
						<span className="tasks-view__title">{task.title}</span>
						{hasDescription && (
							<span className="tasks-view__description">
								{task.description}
							</span>
						)}
					</div>
					{isEditable ? (
						<div className="tasks-view__controls">
							<button
								className="tasks-view__edit-toggle"
								type="button"
								onClick={() => setEditing(true)}
								aria-label={`Edit ${task.title}`}
							>
								Edit
							</button>
							<StatusSelect task={task} onChanged={onChanged} />
						</div>
					) : (
						<span className="tasks-view__origin">track</span>
					)}
				</>
			)}
		</li>
	)
}

export default TaskItem
