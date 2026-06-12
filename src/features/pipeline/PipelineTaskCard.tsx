import { updateTask } from '@/features/tasks/tasks'
import { pushToast } from '@/shared/toasts'

import { launchTaskAgent } from './launchTaskAgent'
import type { TaskEntry } from './pipelineColumns'

type Props = {
	entry: TaskEntry
	repoPath: string | null
	onChanged: () => void
}

const markDone = async (
	entry: TaskEntry,
	onChanged: () => void,
): Promise<void> => {
	await updateTask({
		id: entry.task.id,
		title: entry.task.title,
		description: entry.task.description,
		status: 'done',
	})
	pushToast('Task done ✓')
	onChanged()
}

export const PipelineTaskCard = ({
	entry,
	repoPath,
	onChanged,
}: Props): React.JSX.Element => {
	const { task } = entry
	const blocked = task.status === 'blocked'

	return (
		<article className="pipeline__card" data-task-status={task.status}>
			<div className="pipeline__card-row">
				{task.size !== null && (
					<span className="pipeline__size">{task.size}</span>
				)}
				{entry.branch !== null && (
					<span className="pipeline__branch">{entry.branch}</span>
				)}
			</div>
			<p className="pipeline__title">{task.title}</p>
			{blocked && task.blockedReason !== null && (
				<p className="pipeline__blocked">⚑ {task.blockedReason}</p>
			)}
			{task.status === 'done' && (
				<p className="pipeline__done-note">✓ done</p>
			)}
			{(task.status === 'backlog' || blocked) && (
				<button
					type="button"
					className="pipeline__action pipeline__action--primary"
					disabled={blocked || repoPath === null}
					onClick={() => {
						if (repoPath === null) return
						void launchTaskAgent(task, repoPath).then(sessionId => {
							if (sessionId !== null) onChanged()
						})
					}}
				>
					▶ Launch agent
				</button>
			)}
			{task.status === 'in_progress' && (
				<button
					type="button"
					className="pipeline__action"
					onClick={() => void markDone(entry, onChanged)}
				>
					✓ Mark done
				</button>
			)}
		</article>
	)
}
