import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'

import { projectHue, projectName } from '@/features/missionControl/projectGroups'
import { useProjects } from '@/features/projects/useProjects'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import type { SessionState } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'
import { useOverviews } from '@/features/tasks/useOverviews'
import { pushToast } from '@/shared/toasts'

import { approvedSessionIdsAtom, approveSessionAtom } from './approvedSessions'
import { PipelineColumn } from './PipelineColumn'
import type { TaskEntry } from './pipelineColumns'
import { groupColumnByRepo, pipelineColumns } from './pipelineColumns'
import { PipelineMergedCard } from './PipelineMergedCard'
import { PipelineSessionCard } from './PipelineSessionCard'
import { PipelineTaskCard } from './PipelineTaskCard'

type Props = {
	activeProjectPath: string | null
}

type RepoLabelProps = {
	repoPath: string | null
}

// The thin per-repo separator inside a column, shown only on multi-repo
// boards: name + stable hue dot, same identity as Mission Control groups.
const RepoLabel = ({ repoPath }: RepoLabelProps): React.JSX.Element => (
	<div className="pipeline__repo" data-hue={projectHue(repoPath)}>
		<span className="pipeline__repo-dot" aria-hidden="true" />
		{projectName(repoPath)}
	</div>
)

type ColumnCardsProps = {
	sessions: ReadonlyArray<SessionState>
	entries: ReadonlyArray<TaskEntry>
	showRepoLabels: boolean
	renderSession: (session: SessionState) => React.JSX.Element
	renderEntry: (entry: TaskEntry, index: number) => React.JSX.Element
}

// One column's body: cards grouped by repo (sessions before tasks inside a
// group), with the repo separator only when the board spans several repos.
const ColumnCards = ({
	sessions,
	entries,
	showRepoLabels,
	renderSession,
	renderEntry,
}: ColumnCardsProps): React.JSX.Element => (
	<>
		{groupColumnByRepo(sessions, entries).map(group => (
			<div
				key={group.repoPath ?? 'no-project'}
				className="pipeline__repo-group"
			>
				{showRepoLabels && <RepoLabel repoPath={group.repoPath} />}
				{group.sessions.map(renderSession)}
				{group.entries.map(renderEntry)}
			</div>
		))}
	</>
)

export const PipelineView = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const { projects } = useProjects()
	// The board reads the whole registry (MP5); before the registry loads —
	// or off-registry — the active project alone keeps the board truthful.
	const repos =
		projects.length > 0
			? projects
			: activeProjectPath === null
				? []
				: [activeProjectPath]
	const { overviews, refetch } = useOverviews(repos)
	const sessions = useSessions()
	const approvedSessionIds = useAtomValue(approvedSessionIdsAtom)
	const approveSession = useSetAtom(approveSessionAtom)
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

	if (repos.length === 0) {
		return (
			<section className="pipeline pipeline--empty" aria-label="Pipeline">
				<p>Add a repository to see its pipeline.</p>
			</section>
		)
	}

	const columns = pipelineColumns(overviews, sessions, approvedSessionIds)
	// Repo separators appear once the board actually spans several repos.
	const repoCount = new Set([
		...sessions.map(session => session.repoPath),
		...overviews.flatMap(overview =>
			overview.userTasks.map(task => task.repoPath),
		),
		...repos,
	]).size
	const showRepoLabels = repoCount > 1
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
					<ColumnCards
						sessions={[]}
						entries={columns.backlog}
						showRepoLabels={showRepoLabels}
						renderSession={() => <></>}
						renderEntry={(entry, index) => (
							<PipelineTaskCard
								key={entry.task.id}
								entry={entry}
								onChanged={refetch}
								isFirst={index === 0}
								onLaunched={markFresh}
							/>
						)}
					/>
				</PipelineColumn>
				<PipelineColumn
					title="Running"
					count={runningCount}
					dot="run"
					si={1}
				>
					<ColumnCards
						sessions={columns.runningSessions}
						entries={columns.inProgressTasks}
						showRepoLabels={showRepoLabels}
						renderSession={session => (
							<PipelineSessionCard
								key={session.id}
								session={session}
								fresh={freshSessionIds.has(session.id)}
							/>
						)}
						renderEntry={entry => (
							<PipelineTaskCard
								key={entry.task.id}
								entry={entry}
								onChanged={refetch}
							/>
						)}
					/>
				</PipelineColumn>
				<PipelineColumn
					title="Review"
					count={columns.endedSessions.length}
					dot="rev"
					si={2}
				>
					{columns.endedSessions.length === 0 && (
						<p className="pipeline__empty">nothing waiting on you</p>
					)}
					<ColumnCards
						sessions={columns.endedSessions}
						entries={[]}
						showRepoLabels={showRepoLabels}
						renderSession={session => (
							<PipelineSessionCard
								key={session.id}
								session={session}
								isFirst={session.id === firstReviewId}
								onApprove={() => approve(session.id)}
							/>
						)}
						renderEntry={() => <></>}
					/>
				</PipelineColumn>
				<PipelineColumn
					title="Done"
					count={doneCount}
					dot="done"
					si={3}
				>
					<ColumnCards
						sessions={columns.doneSessions}
						entries={columns.done}
						showRepoLabels={showRepoLabels}
						renderSession={session => (
							<PipelineMergedCard
								key={session.id}
								session={session}
								fresh={freshSessionIds.has(session.id)}
							/>
						)}
						renderEntry={entry => (
							<PipelineTaskCard
								key={entry.task.id}
								entry={entry}
								onChanged={refetch}
							/>
						)}
					/>
				</PipelineColumn>
			</div>
		</section>
	)
}
