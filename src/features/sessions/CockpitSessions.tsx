import { agentRunHref, navigate } from '@/app/router'

import { sessionDisplayStatus } from './displayStatus'
import { sessionLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { useSessions } from './useSessions'

type GroupProps = {
	title: string
	sessions: ReadonlyArray<SessionState>
	activeSessionId: string
}

const SessionGroup = ({
	title,
	sessions,
	activeSessionId,
}: GroupProps): React.JSX.Element | null => {
	if (sessions.length === 0) return null
	return (
		<>
			<h3 className="cockpit-sessions__group">
				{title} · {sessions.length}
			</h3>
			<ul className="cockpit-sessions__list">
				{sessions.map(session => (
					<li key={session.id}>
						<a
							className="cockpit-sessions__row"
							href={agentRunHref(session.id)}
							aria-current={
								session.id === activeSessionId
									? 'page'
									: undefined
							}
							title={session.id}
							onClick={event => {
								event.preventDefault()
								navigate(agentRunHref(session.id))
							}}
						>
							<span
								className="status-dot"
								data-status={sessionDisplayStatus(session)}
							/>
							<span className="cockpit-sessions__label">
								{sessionLabel(session)}
							</span>
						</a>
					</li>
				))}
			</ul>
		</>
	)
}

type Props = {
	activeSessionId: string
}

export const CockpitSessions = ({
	activeSessionId,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const running = sessions.filter(session => session.status === 'running')
	const ended = sessions.filter(session => session.status === 'ended')

	return (
		<nav className="cockpit-sessions" aria-label="Sessions">
			<SessionGroup
				title="Running"
				sessions={running}
				activeSessionId={activeSessionId}
			/>
			<SessionGroup
				title="Ended"
				sessions={ended}
				activeSessionId={activeSessionId}
			/>
		</nav>
	)
}
