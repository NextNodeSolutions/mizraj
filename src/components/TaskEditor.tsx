import { useState } from 'react'

import { describeError } from '../errors'
import type { Task } from '../lib/tasks'
import { updateTask } from '../lib/tasks'

type TaskEditorProps = {
	task: Task
	onSaved: () => void
	onCancel: () => void
	nameOnly?: boolean
}

const TaskEditor = ({
	task,
	onSaved,
	onCancel,
	nameOnly = false,
}: TaskEditorProps): React.JSX.Element => {
	const [title, setTitle] = useState(task.title)
	const [description, setDescription] = useState(task.description ?? '')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const trimmedTitle = title.trim()
	const canSave = trimmedTitle !== '' && !submitting

	const titlePlaceholder = nameOnly ? 'Task name' : 'Task title'
	const titleAriaLabel = nameOnly
		? `Name for ${task.title}`
		: `Title for ${task.title}`
	const errorPrefix = nameOnly
		? 'Could not rename task'
		: 'Could not save task'

	const deriveDescription = (): string | null => {
		if (nameOnly) return task.description
		const trimmedDescription = description.trim()
		return trimmedDescription === '' ? null : trimmedDescription
	}

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
				description: deriveDescription(),
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
				placeholder={titlePlaceholder}
				aria-label={titleAriaLabel}
			/>
			{!nameOnly && (
				<input
					className="tasks-view__input"
					type="text"
					value={description}
					onChange={event => setDescription(event.target.value)}
					placeholder="Description (optional)"
					aria-label={`Description for ${task.title}`}
				/>
			)}
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
					{errorPrefix}: {error}
				</span>
			)}
		</form>
	)
}

export default TaskEditor
