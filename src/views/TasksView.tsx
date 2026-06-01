import TaskCreateForm from '../components/TaskCreateForm'
import TasksBody from '../components/TasksBody'
import { useTasks } from '../lib/tasks'

type Props = {
	repoPath: string | null
}

const TasksView = ({ repoPath }: Props): React.JSX.Element => {
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

export default TasksView
