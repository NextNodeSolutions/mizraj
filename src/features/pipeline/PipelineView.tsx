import { useSessions } from '@/features/sessions/useSessions'
import { useTasks } from '@/features/tasks/tasks'

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

	if (activeProjectPath === null) {
		return (
			<section className="pipeline pipeline--empty" aria-label="Pipeline">
				<p>Select a repository to see its pipeline.</p>
			</section>
		)
	}

	const overview = state.status === 'ready' ? state.data : null
	const columns = pipelineColumns(overview, sessions)
	const runningCount =
		columns.runningSessions.length + columns.inProgressTasks.length

	return (
		<section className="pipeline" aria-label="Pipeline">
			{state.status === 'error' && (
				<p className="pipeline__error" role="alert">
					Tasks unavailable: {state.message}
				</p>
			)}
			<div className="pipeline__cols">
				<PipelineColumn title="Backlog" count={columns.backlog.length}>
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
					status="running"
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
					status="review"
				>
					{columns.endedSessions.map(session => (
						<PipelineSessionCard
							key={session.id}
							session={session}
						/>
					))}
				</PipelineColumn>
				<PipelineColumn title="Done" count={columns.done.length}>
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
