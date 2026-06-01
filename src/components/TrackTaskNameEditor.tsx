import { useState } from 'react'

import { describeError } from '../errors'
import type { Task } from '../lib/tasks'
import { updateTask } from '../lib/tasks'

type TrackTaskNameEditorProps = {
	task: Task
	onSaved: () => void
	onCancel: () => void
}

const TrackTaskNameEditor = ({
	task,
	onSaved,
	onCancel,
}: TrackTaskNameEditorProps): React.JSX.Element => {
	const [title, setTitle] = useState(task.title)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const trimmedTitle = title.trim()
	const canSave = trimmedTitle !== '' && !submitting

	const handleSubmit = async (
		event: React.FormEvent<HTMLFormElement>,
	): Promise<void> => {
		event.preventDefault()
		if (!canSave) return
		setSubmitting(true)
		setError(null)
		try {
			await updateTask({
				id: task.id,
				title: trimmedTitle,
				description: task.description,
				status: task.status,
			})
			onSaved()
		} catch (caught: unknown) {
			setError(describeError(caught).message)
			setSubmitting(false)
		}
	}

	return (
		<form
			className="tasks-view__edit"
			onSubmit={event => void handleSubmit(event)}
		>
			<input
				className="tasks-view__input"
				type="text"
				value={title}
				onChange={event => setTitle(event.target.value)}
				placeholder="Task name"
				aria-label={`Name for ${task.title}`}
			/>
			<div className="tasks-view__edit-actions">
				<button
					className="tasks-view__submit"
					type="submit"
					disabled={!canSave}
				>
					Save
				</button>
				<button
					className="tasks-view__edit-cancel"
					type="button"
					onClick={onCancel}
					disabled={submitting}
				>
					Cancel
				</button>
			</div>
			{error !== null && (
				<span className="tasks-view__item-error" role="alert">
					Could not rename task: {error}
				</span>
			)}
		</form>
	)
}

export default TrackTaskNameEditor
