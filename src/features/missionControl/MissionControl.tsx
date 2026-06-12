import { useState } from 'react'

import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { RunAgentButton } from '@/features/sessions/RunAgentButton'
import type { SessionState } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'
import { useNow } from '@/shared/useNow'

import { AgentCard } from './AgentCard'

const AGE_REFRESH_MS = 30_000

type StatusFilter = 'all' | SessionDisplayStatus

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'running', label: 'Running' },
	{ key: 'review', label: 'Needs review' },
	{ key: 'failed', label: 'Failed' },
]

const STATUS_ORDER: Readonly<Record<SessionDisplayStatus, number>> = {
	running: 0,
	review: 1,
	failed: 2,
}

// Active work first, then most recently started — the cmux "what's hot" wall.
const compareCards = (a: SessionState, b: SessionState): number => {
	const byStatus =
		STATUS_ORDER[sessionDisplayStatus(a)] -
		STATUS_ORDER[sessionDisplayStatus(b)]
	return byStatus !== 0 ? byStatus : b.startedAt - a.startedAt
}

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

	const visible = sessions
		.filter(
			session =>
				filter === 'all' || sessionDisplayStatus(session) === filter,
		)
		.toSorted(compareCards)

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
			<div className="mission-control__grid">
				{visible.map(session => (
					<AgentCard key={session.id} session={session} now={now} />
				))}
			</div>
		</section>
	)
}
