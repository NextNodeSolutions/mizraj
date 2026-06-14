import { useState } from 'react'

import { agentRunHref } from '@/app/router'
import { formatSessionAge } from '@/features/missionControl/sessionAge'
import { Panel, PanelHead, SDot } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'
import { useNow } from '@/shared/useNow'

import {
	DISPLAY_STATUS_LABEL,
	sessionDisplayStatus,
	sessionDotKind,
} from './displayStatus'
import { launchSession } from './launchSession'
import { openSession } from './openSession'
import { sessionLabel, sessionRepoLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { useSessions } from './useSessions'

const AGENT_BINARY = 'claude'

const AGE_REFRESH_MS = 30_000

// TODO(backend): per-session branch — sessions are not bound to a worktree/branch (worktree.rs exposes no command; repo_head covers only the active project). Render sessionRepoLabel(session) until a session→branch mapping exists.
// TODO(backend): per-session diff stats unavailable — get_diff is the active project's working tree, not attributable to one session. Omit +/− in session rows; show repo · age instead.
// TODO(backend): no merged/landed tracking for ended sessions. Ended rows show DISPLAY_STATUS_LABEL (needs review / failed) only.
const sessionMeta = (
	session: SessionState,
	now: number,
	showRepo: boolean,
): string => {
	const tail =
		session.status === 'running'
			? formatSessionAge(now, session.startedAt)
			: DISPLAY_STATUS_LABEL[sessionDisplayStatus(session)]
	const repo = showRepo ? sessionRepoLabel(session) : null
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
	showRepo: boolean
}

const SessionRow = ({
	session,
	active,
	now,
	showRepo,
}: RowProps): React.JSX.Element => (
	<a
		className="lrow"
		href={agentRunHref(session.id)}
		aria-current={active ? 'page' : undefined}
		data-on={active}
		title={session.id}
		onClick={event => {
			event.preventDefault()
			openSession(session)
		}}
	>
		<span style={{ marginTop: 5 }}>
			<SDot s={sessionDotKind(session)} />
		</span>
		<div style={{ minWidth: 0 }}>
			{/* TODO(backend): no task/prompt is stored for a session (SessionState has no task field). Render sessionLabel(session) — OSC title or binary basename — as the row title. */}
			<div className="lr-t">{sessionLabel(session)}</div>
			<div className="lr-b">{sessionMeta(session, now, showRepo)}</div>
		</div>
	</a>
)

type GroupProps = {
	title: string
	sessions: ReadonlyArray<SessionState>
	activeSessionId: string
	now: number
	showRepo: boolean
}

const SessionGroup = ({
	title,
	sessions,
	activeSessionId,
	now,
	showRepo,
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
					showRepo={showRepo}
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
	// The cockpit is per-repo (MP2): it follows the active session's repo, so it
	// lists only that repo's sessions — a sibling repo's agents never bleed in.
	// Before any repo is followed (null) nothing scopes the list, so show all.
	const repoSessions =
		activeProjectPath === null
			? sessions
			: sessions.filter(session => session.repoPath === activeProjectPath)
	const running = repoSessions.filter(session => session.status === 'running')
	const ended = repoSessions.filter(session => session.status === 'ended')
	// The list spans repos only when no repo is followed; once scoped to one,
	// every row shares the same repo so the chip is noise.
	const showRepo = activeProjectPath === null

	return (
		<Panel className="fc-sess">
			<PanelHead title="Sessions" count={repoSessions.length}>
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
					showRepo={showRepo}
				/>
				<SessionGroup
					title="Ended"
					sessions={ended}
					activeSessionId={activeSessionId}
					now={now}
					showRepo={showRepo}
				/>
			</nav>
			<div className="fc-sess-foot">
				<span className="mz-kbd">⌘K</span>
				<span>jump between agents</span>
			</div>
		</Panel>
	)
}
