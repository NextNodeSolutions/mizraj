import { useState } from 'react'

import { useDiff } from '@/features/diff/useDiff'
import { repoHeadLabel, useRepoHead } from '@/features/projects/repoHead'
import type { DiffTotals } from '@/features/review/reviewFiles'
import { diffTotals, reviewFilesFromPatch } from '@/features/review/reviewFiles'
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
	now: number
	index: number
}

export const ProjectGroup = ({
	group,
	visibleSessions,
	now,
	index,
}: Props): React.JSX.Element => {
	// Per-group, not persisted: a fold is a quick "mute this project" gesture.
	const [collapsed, setCollapsed] = useState(false)
	// A const binding so the null check narrows inside the launch closure.
	const { repoPath } = group
	const name = projectName(repoPath)
	// One head + one working-tree read per repo group (MP1): every card of
	// the group shows ITS repo's branch and diff stats, never the active
	// project's.
	const head = useRepoHead(repoPath)
	const diff = useDiff(repoPath)
	const branch = head.status === 'ready' ? repoHeadLabel(head.data) : null
	const totals: DiffTotals | null =
		diff.state.status === 'ready'
			? diffTotals(reviewFilesFromPatch(diff.state.data.patch))
			: null

	const toggle = (): void => setCollapsed(current => !current)

	const toggleFromKeyboard = (event: React.KeyboardEvent): void => {
		if (event.key !== 'Enter' && event.key !== ' ') return
		event.preventDefault()
		toggle()
	}
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
			{/* Not a <button>: the header nests the real .proj-add button. */}
			<header
				className="proj-head"
				role="button"
				tabIndex={0}
				aria-expanded={!collapsed}
				onClick={toggle}
				onKeyDown={toggleFromKeyboard}
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
				{repoPath !== null && (
					<button
						type="button"
						className="mz-iconbtn proj-add"
						aria-label={`New agent in ${name}`}
						onClick={event => {
							event.stopPropagation()
							void launchSession({
								binary: AGENT_BINARY,
								repoPath,
							})
						}}
					>
						<IconPlus />
					</button>
				)}
				<span
					className="proj-chev"
					data-collapsed={collapsed ? 'true' : 'false'}
				>
					▾
				</span>
			</header>
			{/* Collapsing unmounts the cards, which releases their frame subscriptions. */}
			{!collapsed && (
				<div className="proj-grid">
					{visibleSessions.map((session, cardIndex) => (
						<AgentCard
							key={session.id}
							session={session}
							now={now}
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
