import { useState } from 'react'

import { describeError } from '../errors'
import type { Task } from '../lib/tasks'
import { TASK_STATUSES, updateTask } from '../lib/tasks'

import { STATUS_CONFIG } from './taskStatusConfig'

type StatusSelectProps = {
	task: Task
	onChanged: () => void
}

const StatusSelect = ({
	task,
	onChanged,
}: StatusSelectProps): React.JSX.Element => {
	const [updating, setUpdating] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleStatusChange = async (value: string): Promise<void> => {
		if (value === task.status) return
		setUpdating(true)
		setError(null)
		try {
			await updateTask({
				id: task.id,
				title: task.title,
				description: task.description,
				status: value,
			})
			// On success the list refetches and this row regroups under the new
			// status, remounting fresh — so we only clear `updating` on error.
			onChanged()
		} catch (caught: unknown) {
			setError(describeError(caught).message)
			setUpdating(false)
		}
	}

	return (
		<div className="tasks-view__status">
			<select
				className="tasks-view__status-select"
				value={task.status}
				disabled={updating}
				onChange={event => void handleStatusChange(event.target.value)}
				aria-label={`Status for ${task.title}`}
			>
				{TASK_STATUSES.map(status => (
					<option key={status} value={status}>
						{STATUS_CONFIG[status].label}
					</option>
				))}
			</select>
			{error !== null && (
				<span className="tasks-view__item-error" role="alert">
					Could not update status: {error}
				</span>
			)}
		</div>
	)
}

export default StatusSelect
