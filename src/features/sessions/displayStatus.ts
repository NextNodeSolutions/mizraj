import type { SDotKind } from '@/shared/ui/atoms'

import type { SessionState } from './sessions'

/**
 * The status axis the cockpit UI communicates, derived from raw session
 * state: `running` while the process lives, `review` when it ended cleanly
 * (the agent finished — its changes await review), `failed` on a non-zero or
 * unknown exit.
 */
export type SessionDisplayStatus = 'running' | 'review' | 'failed'

export const sessionDisplayStatus = (
	session: SessionState,
): SessionDisplayStatus => {
	if (session.status === 'running') return 'running'
	return session.exitCode === 0 ? 'review' : 'failed'
}

export const DISPLAY_STATUS_LABEL: Readonly<
	Record<SessionDisplayStatus, string>
> = {
	running: 'running',
	review: 'needs review',
	failed: 'failed',
}

// The status-dot flavor per display status — the single home for the
// status→dot mapping, shared by the cockpit list, the term tab and the
// mission-control cards.
export const DISPLAY_STATUS_DOT: Readonly<
	Record<SessionDisplayStatus, SDotKind>
> = {
	running: 'run',
	review: 'rev',
	failed: 'fail',
}

export const sessionDotKind = (session: SessionState): SDotKind =>
	DISPLAY_STATUS_DOT[sessionDisplayStatus(session)]
