import { useState } from 'react'

import { describeError } from '../errors'
import type { Task } from '../lib/tasks'
import { updateTask } from '../lib/tasks'

type TaskEditorProps = {
	task: Task
	onSaved: () => void
	onCancel: () => void
}

const TaskEditor = ({
	task,
	onSaved,
	onCancel,
}: TaskEditorProps): React.JSX.Element => {
	const [title, setTitle] = useState(task.title)
	const [description, setDescription] = useState(task.description ?? '')
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
		const trimmedDescription = description.trim()
		try {
			await updateTask({
				id: task.id,
				title: trimmedTitle,
				description:
					trimmedDescription === '' ? null : trimmedDescription,
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
				placeholder="Task title"
				aria-label={`Title for ${task.title}`}
			/>
			<input
				className="tasks-view__input"
				type="text"
				value={description}
				onChange={event => setDescription(event.target.value)}
				placeholder="Description (optional)"
				aria-label={`Description for ${task.title}`}
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
					Could not save task: {error}
				</span>
			)}
		</form>
	)
}

export default TaskEditor
