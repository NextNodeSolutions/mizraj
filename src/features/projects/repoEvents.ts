import { listen } from '@tauri-apps/api/event'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/** Mirror of the backend's `repo-changed` payload (project/watcher.rs). */
export type RepoChangedPayload = {
	repoPath: string
	kind: 'git' | 'worktree' | 'mixed'
}

const REPO_CHANGED_EVENT = 'repo-changed'

/**
 * Invoke `onChange` whenever the backend reports a filesystem change in
 * `repoPath` (MP6: event-driven truth, no polling). Returns the unsubscribe
 * function; events for other repos are ignored so one repo's churn never
 * refetches the others.
 */
export const onRepoChanged = (
	repoPath: string,
	onChange: () => void,
): (() => void) => {
	const unlistenPromise = listen<RepoChangedPayload>(
		REPO_CHANGED_EVENT,
		event => {
			if (event.payload.repoPath === repoPath) onChange()
		},
	).catch((error: unknown) => {
		const { message } = describeError(error)
		logger.error(`onRepoChanged: listen failed: ${message}`, {
			scope: 'repo-events',
			details: { repoPath },
		})
		return null
	})

	return () => {
		void unlistenPromise.then(unlisten => unlisten?.())
	}
}
