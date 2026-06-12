import { useState } from 'react'

import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { RunAgentButton } from '@/features/sessions/RunAgentButton'
import type { SessionState } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'
import { useNow } from '@/shared/useNow'

import { ProjectGroup } from './ProjectGroup'
import { groupSessionsByRepo, orderProjectGroups } from './projectGroups'

const AGE_REFRESH_MS = 30_000

type StatusFilter = 'all' | SessionDisplayStatus

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'running', label: 'Running' },
	{ key: 'review', label: 'Needs review' },
	{ key: 'failed', label: 'Failed' },
]

const matchesFilter = (session: SessionState, filter: StatusFilter): boolean =>
	filter === 'all' || sessionDisplayStatus(session) === filter

type Props = {
	activeProjectPath: string | null
}

export const MissionControl = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const now = useNow(AGE_REFRESH_MS)
	const [filter, setFilter] = useState<StatusFilter>('all')

	if (sessions.length === 0) {
		return (
			<section className="mission-control" aria-label="Mission control">
				<div className="mission-control__empty">
					<p>No agents yet.</p>
					{activeProjectPath !== null && (
						<RunAgentButton repoPath={activeProjectPath} />
					)}
				</div>
			</section>
		)
	}

	const countFor = (key: StatusFilter): number =>
		key === 'all'
			? sessions.length
			: sessions.filter(session => sessionDisplayStatus(session) === key)
					.length

	const groups = orderProjectGroups(
		groupSessionsByRepo(sessions),
		activeProjectPath,
	)
	// A group whose every card is filtered out disappears entirely.
	const visibleGroups = groups
		.map(group => ({
			group,
			visibleSessions: group.sessions.filter(session =>
				matchesFilter(session, filter),
			),
		}))
		.filter(({ visibleSessions }) => visibleSessions.length > 0)

	return (
		<section className="mission-control" aria-label="Mission control">
			<div
				className="mission-control__filters"
				role="group"
				aria-label="Filter agents"
			>
				{FILTERS.map(({ key, label }) => (
					<button
						key={key}
						type="button"
						className="mission-control__chip"
						aria-pressed={filter === key}
						onClick={() => setFilter(key)}
					>
						{label} <b>{countFor(key)}</b>
					</button>
				))}
			</div>
			<div className="mc-projects stagger" key={filter}>
				{visibleGroups.map(({ group, visibleSessions }, index) => (
					<ProjectGroup
						key={group.repoPath ?? 'no-project'}
						group={group}
						visibleSessions={visibleSessions}
						now={now}
						index={index}
					/>
				))}
			</div>
		</section>
	)
}
