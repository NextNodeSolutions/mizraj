import { useState } from 'react'

import { useRepoStats } from '@/features/projects/useRepoStats'
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { launchSession } from '@/features/sessions/launchSession'
import type { SessionState } from '@/features/sessions/sessions'
import { SDot } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'

import { AgentCard } from './AgentCard'
import type { SessionGroup } from './projectGroups'
import { compactPath, projectHue, projectName } from './projectGroups'

const STAGGER_STEP_MS = 45

const AGENT_BINARY = 'claude'

const countOf = (
	sessions: ReadonlyArray<SessionState>,
	status: SessionDisplayStatus,
): number =>
	sessions.filter(session => sessionDisplayStatus(session) === status).length

type Props = {
	group: SessionGroup
	visibleSessions: ReadonlyArray<SessionState>
	index: number
}

export const ProjectGroup = ({
	group,
	visibleSessions,
	index,
}: Props): React.JSX.Element => {
	// Per-group, not persisted: a fold is a quick "mute this project" gesture.
	const [collapsed, setCollapsed] = useState(false)
	// A const binding so the null check narrows inside the launch closure.
	const { repoPath } = group
	const name = projectName(repoPath)
	// One head + one working-tree read per repo group (MP1): every card shows
	// ITS repo's branch and diff stats, never the active project's.
	const { branch, totals } = useRepoStats(repoPath)

	const toggle = (): void => setCollapsed(current => !current)
	// Header stats always describe the whole group, never the filtered view.
	const runningCount = countOf(group.sessions, 'running')
	const reviewCount = countOf(group.sessions, 'review')
	const failedCount = countOf(group.sessions, 'failed')

	return (
		<section
			className="proj-group"
			data-hue={projectHue(repoPath)}
			style={{ animationDelay: `${index * STAGGER_STEP_MS}ms` }}
		>
			{/* The disclosure toggle and the launch button are siblings — neither
			    nests the other (no invalid nested interactives). */}
			<header className="proj-head">
				<button
					type="button"
					className="proj-disclosure"
					aria-expanded={!collapsed}
					onClick={toggle}
				>
					<span className="proj-glyph">
						{name.charAt(0).toUpperCase()}
					</span>
					<span className="proj-name">{name}</span>
					<span className="proj-dir">{compactPath(repoPath)}</span>
					<span className="mz-spacer" />
					<span className="proj-stats">
						{runningCount > 0 && (
							<span className="ps">
								<SDot s="run" /> {runningCount} running
							</span>
						)}
						{reviewCount > 0 && (
							<span className="ps">
								<SDot s="rev" /> {reviewCount} review
							</span>
						)}
						{failedCount > 0 && (
							<span className="ps">
								<SDot s="fail" /> {failedCount} failed
							</span>
						)}
						{/* TODO(backend): subagent counts — "{nSub} subagents" as .ps.ps-dim once sessions expose subagents */}
					</span>
					<span
						className="proj-chev"
						data-collapsed={collapsed ? 'true' : 'false'}
					>
						▾
					</span>
				</button>
				{repoPath !== null && (
					<button
						type="button"
						className="mz-iconbtn proj-add"
						aria-label={`New agent in ${name}`}
						onClick={() => {
							void launchSession({
								binary: AGENT_BINARY,
								repoPath,
							})
						}}
					>
						<IconPlus />
					</button>
				)}
			</header>
			{/* Collapsing unmounts the cards, which releases their frame subscriptions. */}
			{!collapsed && (
				<div className="proj-grid">
					{visibleSessions.map((session, cardIndex) => (
						<AgentCard
							key={session.id}
							session={session}
							branch={branch}
							diff={totals}
							style={{
								animationDelay: `${cardIndex * STAGGER_STEP_MS}ms`,
							}}
						/>
					))}
				</div>
			)}
		</section>
	)
}
