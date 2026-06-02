import type { OverviewState } from './tasks'
import { TasksContent } from './TasksContent'

type TasksBodyProps = {
	state: OverviewState
	onChanged: () => void
}

export const TasksBody = ({
	state,
	onChanged,
}: TasksBodyProps): React.JSX.Element => {
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
	return <TasksContent overview={state.data} onChanged={onChanged} />
}
