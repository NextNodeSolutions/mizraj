import type { SessionState } from '@/features/sessions/sessions'

const isAgentBinary = (binary: string): boolean =>
	(binary.split('/').pop() ?? binary).startsWith('claude')

/**
 * The session a review remark should land in: the most recently started
 * running session of the repo, preferring an agent (`claude*`) over a plain
 * shell. Null when nothing in the repo can receive input.
 */
export const pickAgentSession = (
	sessions: ReadonlyArray<SessionState>,
	repoPath: string | null,
): SessionState | null => {
	if (repoPath === null) return null
	const candidates = sessions
		.filter(
			session =>
				session.status === 'running' && session.repoPath === repoPath,
		)
		.toSorted((a, b) => b.startedAt - a.startedAt)
	return (
		candidates.find(session => isAgentBinary(session.binary)) ??
		candidates[0] ??
		null
	)
}
