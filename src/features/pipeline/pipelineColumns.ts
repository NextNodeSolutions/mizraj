import type { SessionState } from '@/features/sessions/sessions'
import type { Overview, Task } from '@/features/tasks/tasks'

/** A task plus the branch its track points at (null for user tasks). */
export type TaskEntry = {
	task: Task
	branch: string | null
}

export type PipelineColumns = {
	backlog: ReadonlyArray<TaskEntry>
	inProgressTasks: ReadonlyArray<TaskEntry>
	runningSessions: ReadonlyArray<SessionState>
	endedSessions: ReadonlyArray<SessionState>
	doneSessions: ReadonlyArray<SessionState>
	done: ReadonlyArray<TaskEntry>
}

const flattenEntries = (overview: Overview): ReadonlyArray<TaskEntry> => [
	...overview.milestones.flatMap(milestone =>
		milestone.tracks.flatMap(track =>
			track.tasks.map(task => ({ task, branch: track.branch })),
		),
	),
	...overview.userTasks.map(task => ({ task, branch: null })),
]

const byStatus = (
	entries: ReadonlyArray<TaskEntry>,
	statuses: ReadonlyArray<Task['status']>,
): ReadonlyArray<TaskEntry> =>
	entries.filter(entry => statuses.includes(entry.task.status))

/**
 * Project the task tree and the live session set onto the four pipeline
 * columns. Blocked tasks stay in the backlog (visible, not actionable);
 * ended sessions land in Review whatever their exit — the card's status
 * badge tells review from failure — until they are approved, which moves
 * them to Done as `doneSessions`.
 */
export const pipelineColumns = (
	overview: Overview | null,
	sessions: ReadonlyArray<SessionState>,
	approvedSessionIds: ReadonlySet<string>,
): PipelineColumns => {
	const entries = overview === null ? [] : flattenEntries(overview)
	const ended = sessions.filter(session => session.status === 'ended')
	return {
		backlog: byStatus(entries, ['backlog', 'blocked']),
		inProgressTasks: byStatus(entries, ['in_progress']),
		runningSessions: sessions.filter(
			session => session.status === 'running',
		),
		endedSessions: ended.filter(
			session => !approvedSessionIds.has(session.id),
		),
		doneSessions: ended.filter(session =>
			approvedSessionIds.has(session.id),
		),
		done: byStatus(entries, ['done']),
	}
}
