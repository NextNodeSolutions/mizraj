import type { Track, TaskState, TrackTask, TrackState } from '../lib/tasks'
import { TASK_STATES, useTrack } from '../lib/tasks'

const STATE_CONFIG: Record<TaskState, { label: string; marker: string }> = {
	in_progress: { label: 'In progress', marker: '◐' },
	pending: { label: 'To do', marker: '○' },
	done: { label: 'Done', marker: '✓' },
	blocked: { label: 'Blocked', marker: '⚠' },
}

type Props = {
	repoPath: string | null
}

type GroupProps = {
	state: TaskState
	tasks: ReadonlyArray<TrackTask>
}

const TrackGroup = ({ state, tasks }: GroupProps): React.JSX.Element => (
	<section className="tasks-view__group">
		<h3 className="tasks-view__heading">
			{STATE_CONFIG[state].label}{' '}
			<span className="tasks-view__count">{tasks.length}</span>
		</h3>
		<ul className="tasks-view__list">
			{tasks.map(task => (
				<li
					key={task.identifier}
					className={`tasks-view__item tasks-view__item--${task.state}`}
				>
					<span
						className="tasks-view__marker"
						aria-hidden="true"
					>
						{STATE_CONFIG[task.state].marker}
					</span>
					<span className="tasks-view__identifier">
						{task.identifier}
					</span>
					<span className="tasks-view__title">{task.title}</span>
					{task.commit !== null && (
						<span className="tasks-view__commit">{task.commit}</span>
					)}
				</li>
			))}
		</ul>
	</section>
)

const renderTrack = (track: Track | null): React.JSX.Element => {
	if (track === null || track.tasks.length === 0) {
		return (
			<p className="tasks-view__empty">No active track for this project.</p>
		)
	}
	return (
		<>
			<header className="tasks-view__track-header">
				<p className="tasks-view__track-title">{track.title}</p>
				{track.milestone !== '' && (
					<p className="tasks-view__track-milestone">
						{track.milestone}
					</p>
				)}
			</header>
			{TASK_STATES.map(state => {
				const tasks = track.tasks.filter(task => task.state === state)
				return tasks.length === 0 ? null : (
					<TrackGroup key={state} state={state} tasks={tasks} />
				)
			})}
		</>
	)
}

const renderState = (state: TrackState): React.JSX.Element => {
	if (state.status === 'idle') {
		return <p className="tasks-view__empty">No project selected.</p>
	}
	if (state.status === 'loading') {
		return (
			<p className="tasks-view__empty" role="status" aria-live="polite">
				Loading track…
			</p>
		)
	}
	if (state.status === 'error') {
		return (
			<p
				className="tasks-view__empty tasks-view__empty--error"
				role="alert"
			>
				Track unavailable: {state.message}
			</p>
		)
	}
	return renderTrack(state.track)
}

const TasksView = ({ repoPath }: Props): React.JSX.Element => {
	const state = useTrack(repoPath)
	return (
		<section className="tasks-view" aria-label="Track">
			<h2 className="tasks-view__title-bar">Track</h2>
			{renderState(state)}
		</section>
	)
}

export default TasksView
