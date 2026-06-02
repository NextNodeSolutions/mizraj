import { agentRunHref, navigate } from '@/app/router'

import type { SessionState } from './sessions'
import { useSessions } from './useSessions'

const STATUS_LABEL: Readonly<Record<SessionState['status'], string>> = {
	running: 'Running',
	ended: 'Ended',
}

type SessionSidebarProps = {
	activeSessionId: string | null
}

export const SessionSidebar = ({
	activeSessionId,
}: SessionSidebarProps): React.JSX.Element => {
	const sessions = useSessions()

	return (
		<nav className="session-sidebar" aria-label="Sessions">
			<h3 className="session-sidebar__heading">Sessions</h3>
			{sessions.length === 0 ? (
				<p className="session-sidebar__empty">No sessions yet.</p>
			) : (
				<ul className="session-sidebar__list">
					{sessions.map(session => (
						<li key={session.id}>
							<a
								className="session-sidebar__link"
								aria-current={
									session.id === activeSessionId
										? 'page'
										: undefined
								}
								href={agentRunHref(session.id)}
								onClick={event => {
									event.preventDefault()
									navigate(agentRunHref(session.id))
								}}
								title={session.id}
							>
								<span className="session-sidebar__label">
									{session.id}
								</span>
								<span
									className="session-sidebar__status"
									data-status={session.status}
								>
									{STATUS_LABEL[session.status]}
								</span>
							</a>
						</li>
					))}
				</ul>
			)}
		</nav>
	)
}
