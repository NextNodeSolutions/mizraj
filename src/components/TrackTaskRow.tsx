import { useState } from 'react'

import type { Task } from '../lib/tasks'

import TaskEditor from './TaskEditor'
import { STATUS_CONFIG } from './taskStatusConfig'

type TrackTaskRowProps = {
	task: Task
	onChanged: () => void
}

const TrackTaskRow = ({
	task,
	onChanged,
}: TrackTaskRowProps): React.JSX.Element => {
	const [editing, setEditing] = useState(false)
	const isBlocked = task.status === 'blocked'

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
					nameOnly
					onSaved={handleSaved}
					onCancel={() => setEditing(false)}
				/>
			) : (
				<>
					<div className="tasks-view__body">
						<span className="tasks-tree__row-head">
							{task.identifier !== null && (
								<span className="tasks-view__identifier">
									{task.identifier}
								</span>
							)}
							<span className="tasks-view__title">
								{task.title}
							</span>
							{task.size !== null && (
								<span className="tasks-view__size">
									{task.size}
								</span>
							)}
						</span>
						{isBlocked && task.blockedReason !== null && (
							<span className="tasks-view__blocked-reason">
								{task.blockedReason}
							</span>
						)}
					</div>
					<button
						className="tasks-view__edit-toggle"
						type="button"
						onClick={() => setEditing(true)}
						aria-label={`Edit name of ${task.title}`}
					>
						Rename
					</button>
				</>
			)}
		</li>
	)
}

export default TrackTaskRow
