import { useState } from 'react'

import { describeError } from '@/shared/errors'

import { createTask } from './tasks'

type CreateFormProps = {
	onCreated: () => void
}

export const TaskCreateForm = ({
	onCreated,
}: CreateFormProps): React.JSX.Element => {
	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const trimmedTitle = title.trim()
	const canSubmit = trimmedTitle !== '' && !submitting

	const handleSubmit = async (
		event: React.FormEvent<HTMLFormElement>,
	): Promise<void> => {
		event.preventDefault()
		if (!canSubmit) return
		setSubmitting(true)
		setError(null)
		try {
			await createTask(trimmedTitle, description)
			setTitle('')
			setDescription('')
			onCreated()
		} catch (caught: unknown) {
			setError(describeError(caught).message)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<form
			className="tasks-view__form"
			onSubmit={event => void handleSubmit(event)}
		>
			<input
				className="tasks-view__input"
				type="text"
				value={title}
				onChange={event => setTitle(event.target.value)}
				placeholder="New task title"
				aria-label="Task title"
			/>
			<input
				className="tasks-view__input"
				type="text"
				value={description}
				onChange={event => setDescription(event.target.value)}
				placeholder="Description (optional)"
				aria-label="Task description"
			/>
			<button
				className="tasks-view__submit"
				type="submit"
				disabled={!canSubmit}
			>
				Add task
			</button>
			{error !== null && (
				<p className="tasks-view__form-error" role="alert">
					Could not create task: {error}
				</p>
			)}
		</form>
	)
}
