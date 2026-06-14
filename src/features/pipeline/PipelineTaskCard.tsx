import { useState } from 'react'

import type { Task } from '@/features/tasks/tasks'
import { updateTask } from '@/features/tasks/tasks'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { pushToast } from '@/shared/toasts'

import { launchTaskAgent } from './launchTaskAgent'
import type { TaskEntry } from './pipelineColumns'

type Props = {
	entry: TaskEntry
	onChanged: () => void
	/** First card of its column — its action renders as the primary button. */
	isFirst?: boolean
	/** Reports the spawned session id so the view marks its card fresh. */
	onLaunched?: (sessionId: string) => void
}

const markDone = async (
	entry: TaskEntry,
	onChanged: () => void,
): Promise<void> => {
	try {
		await updateTask({
			repoPath: entry.task.repoPath,
			id: entry.task.id,
			title: entry.task.title,
			description: entry.task.description,
			status: 'done',
		})
		pushToast('Task done ✓')
		onChanged()
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`PipelineTaskCard: mark done failed: ${message}`, {
			scope: 'pipeline',
			details: { stack, taskId: entry.task.id },
		})
		pushToast('Could not mark the task done — see logs')
	}
}

const launch = async (
	task: Task,
	onSpawned: (sessionId: string) => void,
): Promise<void> => {
	try {
		const sessionId = await launchTaskAgent(task)
		if (sessionId !== null) onSpawned(sessionId)
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`PipelineTaskCard: launch failed: ${message}`, {
			scope: 'pipeline',
			details: { stack, taskId: task.id },
		})
		pushToast('Agent launch failed — see logs')
	}
}

type MetaRowProps = {
	entry: TaskEntry
}

// Size badge + plan-track ref, rendered only when the task carries either.
const TaskMetaRow = ({ entry }: MetaRowProps): React.JSX.Element | null => {
	if (entry.task.size === null && entry.branch === null) return null
	return (
		<div className="pipeline__card-row">
			{entry.task.size !== null && (
				<span className="pipeline__size">{entry.task.size}</span>
			)}
			{entry.branch !== null && (
				<span className="pipeline__branch">→ {entry.branch}</span>
			)}
		</div>
	)
}

export const PipelineTaskCard = ({
	entry,
	onChanged,
	isFirst = false,
	onLaunched,
}: Props): React.JSX.Element => {
	const { task } = entry
	const blocked = task.status === 'blocked'
	const done = task.status === 'done'
	// Guards the async spawn→update chain: a second click while the first is
	// in flight would spawn a second agent, so the button disables itself and
	// ignores re-clicks until the promise settles.
	const [pending, setPending] = useState(false)

	const runLaunch = (): void => {
		if (pending) return
		setPending(true)
		void launch(task, sessionId => {
			onLaunched?.(sessionId)
			onChanged()
		}).finally(() => setPending(false))
	}

	const runMarkDone = (): void => {
		if (pending) return
		setPending(true)
		void markDone(entry, onChanged).finally(() => setPending(false))
	}

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
			{!done && <TaskMetaRow entry={entry} />}
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
						disabled={blocked || pending}
						onClick={runLaunch}
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
						disabled={pending}
						onClick={runMarkDone}
					>
						✓ Mark done
					</button>
				</div>
			)}
		</article>
	)
}
