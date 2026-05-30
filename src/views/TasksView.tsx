import type { Task, TaskStatus, TasksState } from '../lib/tasks'
import { TASK_STATUSES, useTasks } from '../lib/tasks'

const STATUS_LABELS: Record<TaskStatus, string> = {
	backlog: 'Backlog',
	todo: 'Todo',
	in_progress: 'In progress',
	done: 'Done',
}

type Props = {
	repoPath: string | null
}

type GroupProps = {
	title: string
	tasks: ReadonlyArray<Task>
}

const TasksViewGroup = ({ title, tasks }: GroupProps): React.JSX.Element => (
	<section className="tasks-view__group">
		<h3 className="tasks-view__heading">
			{title} <span className="tasks-view__count">{tasks.length}</span>
		</h3>
		{tasks.length === 0 ? (
			<p className="tasks-view__empty">None.</p>
		) : (
			<ul className="tasks-view__list">
				{tasks.map(task => (
					<li key={task.id} className="tasks-view__item">
						<span className="tasks-view__title">{task.title}</span>
						{task.description !== null && (
							<span className="tasks-view__description">
								{task.description}
							</span>
						)}
					</li>
				))}
			</ul>
		)}
	</section>
)

const renderReady = (tasks: ReadonlyArray<Task>): React.JSX.Element => {
	if (tasks.length === 0) {
		return (
			<p className="tasks-view__empty">No tasks yet for this project.</p>
		)
	}
	return (
		<>
			{TASK_STATUSES.map(status => (
				<TasksViewGroup
					key={status}
					title={STATUS_LABELS[status]}
					tasks={tasks.filter(task => task.status === status)}
				/>
			))}
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
	return renderReady(state.tasks)
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
