import type { Task, TaskStatus, TasksState } from '../lib/tasks'
import { TASK_STATUSES, useTasks } from '../lib/tasks'

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
	return renderTasks(state.tasks)
}

const TasksView = ({ repoPath }: Props): React.JSX.Element => {
	const state = useTasks(repoPath)
	return (
		<section className="tasks-view" aria-label="Tasks">
			<h2 className="tasks-view__title-bar">Tasks</h2>
			{renderState(state)}
		</section>
	)
}

export default TasksView
