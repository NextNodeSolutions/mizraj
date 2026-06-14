import { useAtomValue } from 'jotai'

import { agentRunHref, agentRunIndexHref } from '@/app/router'

import { activeSessionIdAtom } from './sessions'
import type { SessionState } from './sessions'
import { useSessions } from './useSessions'

/**
 * Where "go to the cockpit" (rail button, ⌘2, palette) should land: the
 * active session if it still exists, else the first running session, else
 * the most recently started one, else the cockpit's empty state.
 */
export const cockpitTargetHref = (
	sessions: ReadonlyArray<SessionState>,
	activeSessionId: string | null,
): string => {
	const isActiveAlive =
		activeSessionId !== null &&
		sessions.some(session => session.id === activeSessionId)
	if (isActiveAlive) return agentRunHref(activeSessionId)

	const running = sessions.find(session => session.status === 'running')
	if (running) return agentRunHref(running.id)

	const mostRecent = sessions.reduce<SessionState | null>(
		(latest, session) =>
			latest === null || session.startedAt > latest.startedAt
				? session
				: latest,
		null,
	)
	return mostRecent === null
		? agentRunIndexHref()
		: agentRunHref(mostRecent.id)
}

export const useCockpitTargetHref = (): string => {
	const sessions = useSessions()
	const activeSessionId = useAtomValue(activeSessionIdAtom)
	return cockpitTargetHref(sessions, activeSessionId)
}
