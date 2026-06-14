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

/** One repo's slice of a column: its session cards and task cards together. */
export type ColumnRepoGroup = {
	repoPath: string | null
	sessions: ReadonlyArray<SessionState>
	entries: ReadonlyArray<TaskEntry>
}

/**
 * Group a column's cards by repo, first-seen order (sessions first, then
 * tasks), so multi-repo boards can separate repos visually inside each
 * column. Single-repo boards get one group and render label-free.
 */
export const groupColumnByRepo = (
	sessions: ReadonlyArray<SessionState>,
	entries: ReadonlyArray<TaskEntry>,
): ReadonlyArray<ColumnRepoGroup> => {
	const order: Array<string | null> = []
	const seen = new Set<string | null>()
	const note = (repoPath: string | null): void => {
		if (seen.has(repoPath)) return
		seen.add(repoPath)
		order.push(repoPath)
	}
	for (const session of sessions) note(session.repoPath)
	for (const entry of entries) note(entry.task.repoPath)
	return order.map(repoPath => ({
		repoPath,
		sessions: sessions.filter(session => session.repoPath === repoPath),
		entries: entries.filter(entry => entry.task.repoPath === repoPath),
	}))
}

/**
 * The session that carries the primary Approve button in the Review column.
 * The column re-orders cards by repo ({@link groupColumnByRepo}), so the
 * visually-first Approve is the first reviewable session of the first group
 * that has one — NOT the first in the flat order, which can sit in a later
 * repo group on a multi-repo board. Returns null when no card offers Approve
 * (every ended session failed). `isReviewable` is injected so this module
 * stays free of the display-status layer.
 */
export const primaryApproveSessionId = (
	endedSessions: ReadonlyArray<SessionState>,
	isReviewable: (session: SessionState) => boolean,
): string | null => {
	for (const group of groupColumnByRepo(endedSessions, [])) {
		const reviewable = group.sessions.find(isReviewable)
		if (reviewable !== undefined) return reviewable.id
	}
	return null
}

const byStatus = (
	entries: ReadonlyArray<TaskEntry>,
	statuses: ReadonlyArray<Task['status']>,
): ReadonlyArray<TaskEntry> =>
	entries.filter(entry => statuses.includes(entry.task.status))

/**
 * Project the task trees of every repo and the live session set onto the
 * four pipeline columns (MP5: the board pilots ALL running work). Blocked
 * tasks stay in the backlog (visible, not actionable); ended sessions land
 * in Review whatever their exit — the card's status badge tells review from
 * failure — until they are approved, which moves them to Done as
 * `doneSessions`. Tasks keep their `repoPath` tag, so columns can group
 * visually by repo and actions stay scoped to their card's repo.
 */
export const pipelineColumns = (
	overviews: ReadonlyArray<Overview>,
	sessions: ReadonlyArray<SessionState>,
	approvedSessionIds: ReadonlySet<string>,
): PipelineColumns => {
	const entries = overviews.flatMap(flattenEntries)
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
