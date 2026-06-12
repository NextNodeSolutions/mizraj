import { useState } from 'react'

import { agentRunHref, navigate } from '@/app/router'
import { formatSessionAge } from '@/features/missionControl/sessionAge'
import type { SDotKind } from '@/shared/ui/atoms'
import { Panel, PanelHead, SDot } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'
import { useNow } from '@/shared/useNow'

import type { SessionDisplayStatus } from './displayStatus'
import { DISPLAY_STATUS_LABEL, sessionDisplayStatus } from './displayStatus'
import { launchSession } from './launchSession'
import { sessionLabel, sessionRepoLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { useSessions } from './useSessions'

const AGENT_BINARY = 'claude'

const AGE_REFRESH_MS = 30_000

const DOT_KIND: Readonly<Record<SessionDisplayStatus, SDotKind>> = {
	running: 'run',
	review: 'rev',
	failed: 'fail',
}

/** The status-dot flavor a session renders as (shared with the term tab). */
export const sessionDotKind = (session: SessionState): SDotKind =>
	DOT_KIND[sessionDisplayStatus(session)]

// TODO(backend): per-session branch — sessions are not bound to a worktree/branch (worktree.rs exposes no command; repo_head covers only the active project). Render sessionRepoLabel(session) until a session→branch mapping exists.
// TODO(backend): per-session diff stats unavailable — get_diff is the active project's working tree, not attributable to one session. Omit +/− in session rows; show repo · age instead.
// TODO(backend): no merged/landed tracking for ended sessions. Ended rows show DISPLAY_STATUS_LABEL (needs review / failed) only.
const sessionMeta = (session: SessionState, now: number): string => {
	const tail =
		session.status === 'running'
			? formatSessionAge(now, session.startedAt)
			: DISPLAY_STATUS_LABEL[sessionDisplayStatus(session)]
	const repo = sessionRepoLabel(session)
	return repo === null ? tail : `${repo} · ${tail}`
}

type NewSessionButtonProps = {
	repoPath: string
}

// launchSession navigates to the new pane itself; pending only guards a
// double click while session_create is in flight.
const NewSessionButton = ({
	repoPath,
}: NewSessionButtonProps): React.JSX.Element => {
	const [pending, setPending] = useState(false)

	const handleClick = (): void => {
		setPending(true)
		void launchSession({ binary: AGENT_BINARY, repoPath }).finally(() => {
			setPending(false)
		})
	}

	return (
		<button
			type="button"
			className="mz-iconbtn"
			aria-label="New session"
			disabled={pending}
			aria-busy={pending}
			onClick={handleClick}
		>
			<IconPlus />
		</button>
	)
}

type RowProps = {
	session: SessionState
	active: boolean
	now: number
}

const SessionRow = ({ session, active, now }: RowProps): React.JSX.Element => (
	<a
		className="lrow"
		href={agentRunHref(session.id)}
		aria-current={active ? 'page' : undefined}
		data-on={active}
		title={session.id}
		onClick={event => {
			event.preventDefault()
			navigate(agentRunHref(session.id))
		}}
	>
		<span style={{ marginTop: 5 }}>
			<SDot s={sessionDotKind(session)} />
		</span>
		<div style={{ minWidth: 0 }}>
			{/* TODO(backend): no task/prompt is stored for a session (SessionState has no task field). Render sessionLabel(session) — OSC title or binary basename — as the row title. */}
			<div className="lr-t">{sessionLabel(session)}</div>
			<div className="lr-b">{sessionMeta(session, now)}</div>
		</div>
	</a>
)

type GroupProps = {
	title: string
	sessions: ReadonlyArray<SessionState>
	activeSessionId: string
	now: number
}

const SessionGroup = ({
	title,
	sessions,
	activeSessionId,
	now,
}: GroupProps): React.JSX.Element | null => {
	if (sessions.length === 0) return null
	return (
		<>
			<div className="lgroup">
				{title} · {sessions.length}
			</div>
			{sessions.map(session => (
				<SessionRow
					key={session.id}
					session={session}
					active={session.id === activeSessionId}
					now={now}
				/>
			))}
		</>
	)
}

type Props = {
	activeSessionId: string
	activeProjectPath: string | null
}

export const CockpitSessions = ({
	activeSessionId,
	activeProjectPath,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const now = useNow(AGE_REFRESH_MS)
	const running = sessions.filter(session => session.status === 'running')
	const ended = sessions.filter(session => session.status === 'ended')

	return (
		<Panel className="fc-sess">
			<PanelHead title="Sessions" count={sessions.length}>
				{activeProjectPath !== null && (
					<NewSessionButton repoPath={activeProjectPath} />
				)}
			</PanelHead>
			<nav className="fc-sess-list" aria-label="Sessions">
				<SessionGroup
					title="Running"
					sessions={running}
					activeSessionId={activeSessionId}
					now={now}
				/>
				<SessionGroup
					title="Ended"
					sessions={ended}
					activeSessionId={activeSessionId}
					now={now}
				/>
			</nav>
			<div className="fc-sess-foot">
				<span className="mz-kbd">⌘K</span>
				<span>jump between agents</span>
			</div>
		</Panel>
	)
}
