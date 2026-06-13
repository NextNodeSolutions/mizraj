import { listen } from '@tauri-apps/api/event'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/** Mirror of the backend's `repo-changed` payload (project/watcher.rs). */
export type RepoChangedPayload = {
	repoPath: string
	kind: 'git' | 'worktree' | 'mixed'
}

const REPO_CHANGED_EVENT = 'repo-changed'

// Callbacks keyed by repo, fed by a single `repo-changed` listener registered
// once and never torn down (like the agent-events and split-lifecycle bridges).
// One listener routing by `repoPath` replaces the former one-listen-per-resource
// scheme, so no per-mount `unlisten()` ever races Tauri's internal listener map
// under React.StrictMode — while one repo's churn still never refetches another.
const subscribersByRepo = new Map<string, Set<() => void>>()

let bridgeStarted = false

const startRepoChangedBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	listen<RepoChangedPayload>(REPO_CHANGED_EVENT, event => {
		const subscribers = subscribersByRepo.get(event.payload.repoPath)
		if (!subscribers) return
		for (const notify of subscribers) notify()
	}).catch((error: unknown) => {
		bridgeStarted = false
		const { message, stack } = describeError(error)
		logger.error(`onRepoChanged: listen failed: ${message}`, {
			scope: 'repo-events',
			details: { stack },
		})
	})
}

/**
 * Invoke `onChange` whenever the backend reports a filesystem change in
 * `repoPath` (MP6: event-driven truth, no polling). Returns a synchronous
 * unsubscribe that only drops the callback from the in-memory registry — safe
 * to call repeatedly and across StrictMode remounts; other repos are ignored.
 */
export const onRepoChanged = (
	repoPath: string,
	onChange: () => void,
): (() => void) => {
	startRepoChangedBridge()
	const subscribers = subscribersByRepo.get(repoPath) ?? new Set<() => void>()
	subscribers.add(onChange)
	subscribersByRepo.set(repoPath, subscribers)

	return () => {
		subscribers.delete(onChange)
		if (subscribers.size === 0) subscribersByRepo.delete(repoPath)
	}
}

// Test-only escape hatch so suites can verify from a clean slate.
export const resetRepoEventsForTests = (): void => {
	bridgeStarted = false
	subscribersByRepo.clear()
}
