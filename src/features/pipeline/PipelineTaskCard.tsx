import { updateTask } from '@/features/tasks/tasks'
import { pushToast } from '@/shared/toasts'

import { launchTaskAgent } from './launchTaskAgent'
import type { TaskEntry } from './pipelineColumns'

type Props = {
	entry: TaskEntry
	repoPath: string | null
	onChanged: () => void
	/** First card of its column — its action renders as the primary button. */
	isFirst?: boolean
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
	isFirst = false,
}: Props): React.JSX.Element => {
	const { task } = entry
	const blocked = task.status === 'blocked'
	const done = task.status === 'done'

	return (
		<article
			className="pipeline__card"
			data-task-status={task.status}
			data-done={done ? 'true' : undefined}
		>
			{done && (
				<div className="pipeline__card-row">
					<span className="tag">done</span>
				</div>
			)}
			<p className="pipeline__title">{task.title}</p>
			{!done && (task.size !== null || entry.branch !== null) && (
				<div className="pipeline__card-row">
					{task.size !== null && (
						<span className="pipeline__size">{task.size}</span>
					)}
					{entry.branch !== null && (
						<span className="pipeline__branch">
							→ {entry.branch}
						</span>
					)}
				</div>
			)}
			{blocked && task.blockedReason !== null && (
				<p className="pipeline__blocked">⚑ {task.blockedReason}</p>
			)}
			{done && <p className="pipeline__done-note">✓ done</p>}
			{(task.status === 'backlog' || blocked) && (
				<div className="pipeline__card-actions">
					<button
						type="button"
						className={
							isFirst
								? 'btn btn-primary btn-sm'
								: 'btn btn-outline btn-sm'
						}
						disabled={blocked || repoPath === null}
						onClick={() => {
							if (repoPath === null) return
							void launchTaskAgent(task, repoPath).then(
								sessionId => {
									if (sessionId !== null) onChanged()
								},
							)
						}}
					>
						▶ Launch agent
					</button>
				</div>
			)}
			{task.status === 'in_progress' && (
				<div className="pipeline__card-actions">
					<button
						type="button"
						className="btn btn-outline btn-sm"
						onClick={() => void markDone(entry, onChanged)}
					>
						✓ Mark done
					</button>
				</div>
			)}
		</article>
	)
}
