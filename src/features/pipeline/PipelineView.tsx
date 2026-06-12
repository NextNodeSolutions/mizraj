import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'

import { useDiff } from '@/features/diff/useDiff'
import { diffTotals, reviewFilesFromPatch } from '@/features/review/reviewFiles'
import type { DiffTotals } from '@/features/review/reviewFiles'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { useSessions } from '@/features/sessions/useSessions'
import { useTasks } from '@/features/tasks/tasks'
import { pushToast } from '@/shared/toasts'

import { approvedSessionIdsAtom, approveSessionAtom } from './approvedSessions'
import { PipelineColumn } from './PipelineColumn'
import { pipelineColumns } from './pipelineColumns'
import { PipelineMergedCard } from './PipelineMergedCard'
import { PipelineSessionCard } from './PipelineSessionCard'
import { PipelineTaskCard } from './PipelineTaskCard'

type Props = {
	activeProjectPath: string | null
}

// The active project's working-tree totals — the same diff the Review screen
// opens, so it is identical on every review card.
//TODO: per-session diff stats — needs a session/branch-scoped diff command
// (mizraj_vcs::diff_session exists in the crate but is not exposed as a Tauri
// command)
const useWorkingTreeTotals = (repoPath: string | null): DiffTotals | null => {
	const { state } = useDiff(repoPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	return useMemo(
		() => (patch === null ? null : diffTotals(reviewFilesFromPatch(patch))),
		[patch],
	)
}

export const PipelineView = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const { state, refetch } = useTasks(activeProjectPath)
	const sessions = useSessions()
	const approvedSessionIds = useAtomValue(approvedSessionIdsAtom)
	const approveSession = useSetAtom(approveSessionAtom)
	const reviewStat = useWorkingTreeTotals(activeProjectPath)
	// Session ids whose card just changed column (launched or approved) —
	// those mount with the spring entrance. 'both' animation fill means no
	// cleanup is needed; the set dies with the view.
	const [freshSessionIds, setFreshSessionIds] = useState<ReadonlySet<string>>(
		new Set(),
	)

	const markFresh = (sessionId: string): void => {
		setFreshSessionIds(previous => new Set(previous).add(sessionId))
	}

	const approve = (sessionId: string): void => {
		//TODO: real merge — backend has no approve/merge command (no `git
		// merge`/branch-integration Tauri command in src-tauri/src/lib.rs);
		// wire to a future `merge_session_branch`-style command and drop the
		// client-only approvedSessionIdsAtom
		approveSession(sessionId)
		markFresh(sessionId)
		pushToast('Merged into main')
	}

	if (activeProjectPath === null) {
		return (
			<section className="pipeline pipeline--empty" aria-label="Pipeline">
				<p>Select a repository to see its pipeline.</p>
			</section>
		)
	}

	const overview = state.status === 'ready' ? state.data : null
	const columns = pipelineColumns(overview, sessions, approvedSessionIds)
	const runningCount =
		columns.runningSessions.length + columns.inProgressTasks.length
	const doneCount = columns.doneSessions.length + columns.done.length
	// The column mixes review and failed cards; the primary Approve belongs to
	// the first card that actually offers one.
	const firstReviewId =
		columns.endedSessions.find(
			session => sessionDisplayStatus(session) === 'review',
		)?.id ?? null

	return (
		<section className="pipeline" aria-label="Pipeline">
			{state.status === 'error' && (
				<p className="pipeline__error" role="alert">
					Tasks unavailable: {state.message}
				</p>
			)}
			<div className="pipeline__cols stagger">
				<PipelineColumn
					title="Backlog"
					count={columns.backlog.length}
					dot="done"
					si={0}
				>
					{columns.backlog.length === 0 && (
						<p className="pipeline__empty">
							backlog clear — every task has an agent
						</p>
					)}
					{columns.backlog.map((entry, index) => (
						<PipelineTaskCard
							key={entry.task.id}
							entry={entry}
							repoPath={activeProjectPath}
							onChanged={refetch}
							isFirst={index === 0}
							onLaunched={markFresh}
						/>
					))}
				</PipelineColumn>
				<PipelineColumn
					title="Running"
					count={runningCount}
					dot="run"
					si={1}
				>
					{columns.runningSessions.map(session => (
						<PipelineSessionCard
							key={session.id}
							session={session}
							fresh={freshSessionIds.has(session.id)}
						/>
					))}
					{columns.inProgressTasks.map(entry => (
						<PipelineTaskCard
							key={entry.task.id}
							entry={entry}
							repoPath={activeProjectPath}
							onChanged={refetch}
						/>
					))}
				</PipelineColumn>
				<PipelineColumn
					title="Review"
					count={columns.endedSessions.length}
					dot="rev"
					si={2}
				>
					{columns.endedSessions.length === 0 && (
						<p className="pipeline__empty">
							nothing waiting on you
						</p>
					)}
					{columns.endedSessions.map(session => (
						<PipelineSessionCard
							key={session.id}
							session={session}
							stat={reviewStat}
							isFirst={session.id === firstReviewId}
							onApprove={() => approve(session.id)}
						/>
					))}
				</PipelineColumn>
				<PipelineColumn
					title="Done"
					count={doneCount}
					dot="done"
					si={3}
				>
					{columns.doneSessions.map(session => (
						<PipelineMergedCard
							key={session.id}
							session={session}
							fresh={freshSessionIds.has(session.id)}
						/>
					))}
					{columns.done.map(entry => (
						<PipelineTaskCard
							key={entry.task.id}
							entry={entry}
							repoPath={activeProjectPath}
							onChanged={refetch}
						/>
					))}
				</PipelineColumn>
			</div>
		</section>
	)
}
