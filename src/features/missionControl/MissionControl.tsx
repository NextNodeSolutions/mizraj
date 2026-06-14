import { useEffect, useRef } from 'react'

import type { MissionControlFilter, MissionFilter } from '@/app/router'
import {
	missionControlHref,
	navigate,
	parseMissionFilter,
	useLocationSearch,
} from '@/app/router'
import { useProjects } from '@/features/projects/useProjects'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { RunAgentButton } from '@/features/sessions/RunAgentButton'
import type { SessionState } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'
import { SDot } from '@/shared/ui/atoms'

import { DormantSection } from './DormantSection'
import { ProjectGroup } from './ProjectGroup'
import {
	dormantRepos,
	groupSessionsByRepo,
	orderProjectGroups,
	withActiveGroup,
} from './projectGroups'
import { restartStagger } from './restartStagger'

// TODO(backend): merge tracking — no merged state; the 4th chip filters
// 'failed' instead of design's 'Done'
const FILTER_LABEL: Readonly<Record<MissionFilter, string>> = {
	all: 'All',
	running: 'Running',
	review: 'Needs review',
	failed: 'Failed',
}

const CHIP_ORDER: ReadonlyArray<MissionFilter> = [
	'all',
	'running',
	'review',
	'failed',
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

// Shared by the populated screen and its zero-session state.
const MissionControlHead = (): React.JSX.Element => (
	<div className="view-head">
		<h2>Mission Control</h2>
		<span className="vh-sub">every agent, across every project</span>
	</div>
)

type Props = {
	activeProjectPath: string | null
}

export const MissionControl = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const { projects } = useProjects()
	// The URL is the single source of truth — the topbar status cluster
	// deep-links here with ?filter=running|review.
	const filter = parseMissionFilter(useLocationSearch())
	const staggerRef = useRef<HTMLDivElement>(null)

	// A filter switch replays the entrance on the still-mounted groups, so the
	// stagger returns without remounting (and re-firing repo_head/get_diff).
	useEffect(() => {
		restartStagger(staggerRef.current)
	}, [filter])

	const sessionGroups = groupSessionsByRepo(sessions)
	const dormant = dormantRepos(sessionGroups, projects, activeProjectPath)

	if (sessions.length === 0) {
		return (
			<section className="mc-wrap" aria-label="Mission control">
				<MissionControlHead />
				<div className="mc-empty">
					<p>No agents yet.</p>
					{activeProjectPath !== null && (
						<RunAgentButton repoPath={activeProjectPath} />
					)}
				</div>
				{dormant.length > 0 && <DormantSection repos={dormant} />}
			</section>
		)
	}

	const countFor = (key: MissionFilter): number =>
		key === 'all' ? sessions.length : countByStatus(sessions, key)

	// The followed repo always keeps a top group, even with zero sessions.
	const groups = orderProjectGroups(
		withActiveGroup(sessionGroups, activeProjectPath),
		activeProjectPath,
	)
	// A group whose every card is filtered out disappears entirely — except
	// the followed repo, which keeps its (possibly empty) group pinned on top.
	const visibleGroups = groups
		.map(group => ({
			group,
			isActive: group.repoPath === activeProjectPath,
			visibleSessions: group.sessions.filter(session =>
				matchesFilter(session, filter),
			),
		}))
		.filter(
			({ isActive, visibleSessions }) =>
				isActive || visibleSessions.length > 0,
		)
	const visibleCardCount = visibleGroups.reduce(
		(total, { visibleSessions }) => total + visibleSessions.length,
		0,
	)

	return (
		<section className="mc-wrap" aria-label="Mission control">
			<MissionControlHead />
			<div className="mc-filters">
				{CHIP_ORDER.map(key => (
					<button
						key={key}
						type="button"
						className="chip"
						data-on={filter === key ? 'true' : 'false'}
						onClick={() => navigate(chipHref(key))}
					>
						{key === 'running' && <SDot s="run" />}
						<span>{FILTER_LABEL[key]}</span>
						<b>{countFor(key)}</b>
					</button>
				))}
				<span className="mz-spacer" />
				<span className="mc-scope">
					{groups.length + dormant.length} projects ·{' '}
					{countFor('running')} agents live
				</span>
			</div>
			{visibleCardCount === 0 ? (
				<div className="mc-empty mc-empty--filter">
					<p>
						Nothing {FILTER_LABEL[filter].toLowerCase()} right now.
					</p>
					<button
						type="button"
						className="chip"
						onClick={() => navigate(missionControlHref())}
					>
						Show all <b>{sessions.length}</b>
					</button>
				</div>
			) : (
				<div className="mc-projects stagger" ref={staggerRef}>
					{visibleGroups.map(({ group, visibleSessions }, index) => (
						<ProjectGroup
							key={group.repoPath ?? 'no-project'}
							group={group}
							visibleSessions={visibleSessions}
							index={index}
						/>
					))}
				</div>
			)}
			{dormant.length > 0 && <DormantSection repos={dormant} />}
		</section>
	)
}
