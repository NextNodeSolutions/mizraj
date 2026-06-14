import { agentRunHref, navigate, reviewHref } from '@/app/router'
import { setLastProjectPath } from '@/features/settings/settings'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { SessionState } from './sessions'

type SessionTarget = Pick<SessionState, 'id' | 'repoPath'>

const followSessionRepo = (repoPath: string | null): void => {
	if (repoPath === null) return
	setLastProjectPath(repoPath).catch((error: unknown) => {
		const { message } = describeError(error)
		logger.error(`openSession: preference persist failed: ${message}`, {
			scope: 'open-session',
			details: { repoPath },
		})
	})
}

/**
 * The one gesture behind "select a session" (MP2): the cockpit follows the
 * session — its repo becomes the project preference, then the cockpit opens.
 * The TopBar picker stays the explicit switch; both coexist. Repo-less
 * sessions just open, leaving the preference alone.
 */
export const openSession = (session: SessionTarget): void => {
	followSessionRepo(session.repoPath)
	navigate(agentRunHref(session.id))
}

/**
 * Same follow-the-session gesture for review cards: Review is mono-project
 * (MP5), so the preference retargets to the session's repo before routing.
 */
export const openSessionReview = (session: SessionTarget): void => {
	followSessionRepo(session.repoPath)
	navigate(reviewHref())
}
