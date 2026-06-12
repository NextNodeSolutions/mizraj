import { useEffect } from 'react'

import { agentRunHref, navigate, reviewHref } from '@/app/router'
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionLabel } from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import type { SDotKind } from '@/shared/ui/atoms'
import { SDot, StatusTag } from '@/shared/ui/atoms'

import { formatSessionAge } from './sessionAge'

const TERMINAL_TAIL_LINES = 2

const DOT_KIND: Readonly<Record<SessionDisplayStatus, SDotKind>> = {
	running: 'run',
	review: 'rev',
	failed: 'fail',
}

// A running or failed agent re-opens its terminal; a cleanly ended one goes
// straight to the diff review.
// TODO(backend): review screen is active-project-scoped; a review card from
// another project still opens the active project's diff — needs
// branch/worktree-scoped review
const cardTarget = (session: SessionState): string =>
	sessionDisplayStatus(session) === 'review'
		? reviewHref()
		: agentRunHref(session.id)

type MiniTermProps = {
	session: SessionState
	status: SessionDisplayStatus
}

// The card's two-line "what is it doing right now" window: a live grid tail
// while running, a static state line once the session ended.
const MiniTerm = ({ session, status }: MiniTermProps): React.JSX.Element => {
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TERMINAL_TAIL_LINES)
	// The window is two fixed rows — name them instead of mapping.
	const lastLine = tail.at(-1)
	const previousLine = tail.length > 1 ? tail[0] : undefined

	return (
		<span className="term mini-term" aria-hidden="true">
			{status === 'running' && lastLine === undefined && (
				<div className="term-line">
					<span className="t-dim">› waiting for output…</span>{' '}
					<span className="caret" />
				</div>
			)}
			{status === 'running' && previousLine !== undefined && (
				<div className="term-line">{previousLine}</div>
			)}
			{status === 'running' && lastLine !== undefined && (
				<div className="term-line">
					{lastLine} <span className="caret" />
				</div>
			)}
			{status === 'review' && (
				<>
					<div className="term-line">
						<span className="t-dim">›</span>{' '}
						<span className="t-g">done</span>
					</div>
					<div className="term-line">
						<span className="t-y">⚑ waiting for your review</span>
					</div>
				</>
			)}
			{status === 'failed' && (
				<>
					<div className="term-line">
						<span className="t-r">
							✗ exited with code {session.exitCode}
						</span>
					</div>
					<div className="term-line">
						<span className="t-dim">
							› open to inspect the terminal
						</span>
					</div>
				</>
			)}
		</span>
	)
}

type SubAgent = {
	name: string
	status: 'run' | 'done'
	line: string
}

type SubAgentsProps = {
	subs: ReadonlyArray<SubAgent> | undefined
}

// Forward spec: nothing feeds `subs` yet, so this renders null today. The
// tree markup/CSS are ready for the day session telemetry exposes spawns.
const SubAgents = ({ subs }: SubAgentsProps): React.JSX.Element | null => {
	if (subs === undefined || subs.length === 0) return null

	return (
		<div className="ac-subs">
			{subs.map((sub, index) => (
				<div key={sub.name} className="ac-sub">
					<span className="tree">
						{index === subs.length - 1 ? '└' : '├'}
					</span>
					<SDot s={sub.status} />
					<span className="sub-name">{sub.name}</span>
					<span className="ln">{sub.line}</span>
				</div>
			))}
		</div>
	)
}

type Props = {
	session: SessionState
	now: number
	style?: React.CSSProperties
}

export const AgentCard = ({
	session,
	now,
	style,
}: Props): React.JSX.Element => {
	const status = sessionDisplayStatus(session)

	// Watching is what makes the backend emit frames for this session at all —
	// the card subscribes while visible, exactly like a terminal pane does.
	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<button
			type="button"
			className="agent-card"
			data-status={status}
			style={style}
			onClick={() => navigate(cardTarget(session))}
		>
			<span className="ac-top">
				<SDot s={DOT_KIND[status]} />
				<StatusTag status={status} />
				{/* TODO(backend): per-session worktree branch — sessions only carry repoPath, repo_head is active-project-wide */}
			</span>
			<span className="ac-task">{sessionLabel(session)}</span>
			<MiniTerm session={session} status={status} />
			{status === 'running' && (
				// TODO(backend): subagent telemetry — no Tauri event exposes
				// Claude subagent spawns yet
				<SubAgents subs={undefined} />
			)}
			<span className="ac-foot">
				{/* TODO(backend): per-session diff stats — get_diff returns only the active project's whole working-tree patch */}
				{status === 'review' ? (
					<span className="btn btn-sm gobtn">Review →</span>
				) : (
					<span className="time">
						{formatSessionAge(now, session.startedAt)}
					</span>
				)}
			</span>
		</button>
	)
}
