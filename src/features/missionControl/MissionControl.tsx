import type { MissionControlFilter, MissionFilter } from '@/app/router'
import {
	missionControlHref,
	navigate,
	parseMissionFilter,
	useLocationSearch,
} from '@/app/router'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { RunAgentButton } from '@/features/sessions/RunAgentButton'
import type { SessionState } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'
import { SDot } from '@/shared/ui/atoms'
import { useNow } from '@/shared/useNow'

import { ProjectGroup } from './ProjectGroup'
import { groupSessionsByRepo, orderProjectGroups } from './projectGroups'

const AGE_REFRESH_MS = 30_000

// TODO(backend): merge tracking — no merged state; the 4th chip filters
// 'failed' instead of design's 'Done'
const CHIPS: ReadonlyArray<{ key: MissionFilter; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'running', label: 'Running' },
	{ key: 'review', label: 'Needs review' },
	{ key: 'failed', label: 'Failed' },
]

const chipHref = (key: MissionFilter): string =>
	key === 'all' ? missionControlHref() : missionControlHref(key)

const matchesFilter = (session: SessionState, filter: MissionFilter): boolean =>
	filter === 'all' || sessionDisplayStatus(session) === filter

const countByStatus = (
	sessions: ReadonlyArray<SessionState>,
	status: MissionControlFilter,
): number =>
	sessions.filter(session => sessionDisplayStatus(session) === status).length

type Props = {
	activeProjectPath: string | null
}

export const MissionControl = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const now = useNow(AGE_REFRESH_MS)
	// The URL is the single source of truth — the topbar status cluster
	// deep-links here with ?filter=running|review.
	const filter = parseMissionFilter(useLocationSearch())

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

	const countFor = (key: MissionFilter): number =>
		key === 'all' ? sessions.length : countByStatus(sessions, key)

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
		<section className="mc-wrap" aria-label="Mission control">
			<div className="view-head">
				<h2>Mission Control</h2>
				<span className="vh-sub">
					every agent, across every project
				</span>
			</div>
			<div className="mc-filters">
				{CHIPS.map(({ key, label }) => (
					<button
						key={key}
						type="button"
						className="chip"
						data-on={filter === key ? 'true' : 'false'}
						onClick={() => navigate(chipHref(key))}
					>
						{key === 'running' && <SDot s="run" />}
						<span>{label}</span>
						<b>{countFor(key)}</b>
					</button>
				))}
				<span className="mz-spacer" />
				<span className="mc-scope">
					{groups.length} projects · {countFor('running')} agents live
				</span>
			</div>
			{/* key={filter}: a filter switch remounts the wall and replays the stagger */}
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
