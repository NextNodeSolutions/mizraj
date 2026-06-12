import { useAtomValue } from 'jotai'

import { useSessions } from '@/features/sessions/useSessions'
import { useTasks } from '@/features/tasks/tasks'

import { approvedSessionIdsAtom } from './approvedSessions'
import { PipelineColumn } from './PipelineColumn'
import { pipelineColumns } from './pipelineColumns'
import { PipelineSessionCard } from './PipelineSessionCard'
import { PipelineTaskCard } from './PipelineTaskCard'

type Props = {
	activeProjectPath: string | null
}

export const PipelineView = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const { state, refetch } = useTasks(activeProjectPath)
	const sessions = useSessions()
	const approvedSessionIds = useAtomValue(approvedSessionIdsAtom)

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
					{columns.backlog.map(entry => (
						<PipelineTaskCard
							key={entry.task.id}
							entry={entry}
							repoPath={activeProjectPath}
							onChanged={refetch}
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
						/>
					))}
				</PipelineColumn>
				<PipelineColumn
					title="Done"
					count={doneCount}
					dot="done"
					si={3}
				>
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
