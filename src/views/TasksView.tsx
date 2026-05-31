import { useState } from 'react'

import { describeError } from '../errors'
import type { Task, TaskStatus, TasksState } from '../lib/tasks'
import { createTask, TASK_STATUSES, useTasks } from '../lib/tasks'

const STATUS_CONFIG: Record<TaskStatus, { label: string; marker: string }> = {
	backlog: { label: 'Backlog', marker: '○' },
	in_progress: { label: 'In progress', marker: '◐' },
	done: { label: 'Done', marker: '✓' },
}

type Props = {
	repoPath: string | null
}

type GroupProps = {
	status: TaskStatus
	tasks: ReadonlyArray<Task>
}

const TaskGroup = ({ status, tasks }: GroupProps): React.JSX.Element => (
	<section className="tasks-view__group">
		<h3 className="tasks-view__heading">
			{STATUS_CONFIG[status].label}{' '}
			<span className="tasks-view__count">{tasks.length}</span>
		</h3>
		<ul className="tasks-view__list">
			{tasks.map(task => (
				<li
					key={task.id}
					className={`tasks-view__item tasks-view__item--${task.status}`}
				>
					<span className="tasks-view__marker" aria-hidden="true">
						{STATUS_CONFIG[task.status].marker}
					</span>
					<div className="tasks-view__body">
						<span className="tasks-view__title">{task.title}</span>
						{task.description !== null &&
							task.description !== '' && (
								<span className="tasks-view__description">
									{task.description}
								</span>
							)}
					</div>
					{task.origin === 'track' && (
						<span className="tasks-view__origin">track</span>
					)}
				</li>
			))}
		</ul>
	</section>
)

type CreateFormProps = {
	repoPath: string
	onCreated: () => void
}

const TaskCreateForm = ({
	repoPath,
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
			await createTask(repoPath, trimmedTitle, description)
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

const renderTasks = (tasks: ReadonlyArray<Task>): React.JSX.Element => {
	if (tasks.length === 0) {
		return (
			<p className="tasks-view__empty">No tasks for this project yet.</p>
		)
	}
	return (
		<>
			{TASK_STATUSES.map(status => {
				const group = tasks.filter(task => task.status === status)
				return group.length === 0 ? null : (
					<TaskGroup key={status} status={status} tasks={group} />
				)
			})}
		</>
	)
}

const renderState = (state: TasksState): React.JSX.Element => {
	if (state.status === 'idle') {
		return <p className="tasks-view__empty">No project selected.</p>
	}
	if (state.status === 'loading') {
		return (
			<p className="tasks-view__empty" role="status" aria-live="polite">
				Loading tasks…
			</p>
		)
	}
	if (state.status === 'error') {
		return (
			<p
				className="tasks-view__empty tasks-view__empty--error"
				role="alert"
			>
				Tasks unavailable: {state.message}
			</p>
		)
	}
	return renderTasks(state.data)
}

const TasksView = ({ repoPath }: Props): React.JSX.Element => {
	const { state, refetch } = useTasks(repoPath)
	return (
		<section className="tasks-view" aria-label="Tasks">
			<h2 className="tasks-view__title-bar">Tasks</h2>
			{repoPath !== null && (
				<TaskCreateForm repoPath={repoPath} onCreated={refetch} />
			)}
			{renderState(state)}
		</section>
	)
}

export default TasksView
