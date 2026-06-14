import { TaskCreateForm } from './TaskCreateForm'
import { useTasks } from './tasks'
import { TasksBody } from './TasksBody'

type Props = {
	repoPath: string | null
}

export const TasksView = ({ repoPath }: Props): React.JSX.Element => {
	const { state, refetch } = useTasks(repoPath)
	return (
		<section className="tasks-view" aria-label="Tasks">
			<h2 className="tasks-view__title-bar">Tasks</h2>
			{repoPath !== null && (
				<TaskCreateForm repoPath={repoPath} onCreated={refetch} />
			)}
			<TasksBody state={state} onChanged={refetch} />
		</section>
	)
}
