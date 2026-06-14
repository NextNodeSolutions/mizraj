import { getCurrentWindow } from '@tauri-apps/api/window'

import { describeError } from './errors'
import { logger } from './logger'

// Subscribers notified each time the app window regains focus. A single
// `onFocusChanged` bridge feeds them all: it is registered once and never torn
// down (like the agent-events and split-lifecycle bridges), so no per-mount
// `unlisten()` ever races Tauri's internal listener map under React.StrictMode.
const focusSubscribers = new Set<() => void>()

// `idle` until a registration is in flight; `live` once Tauri confirms the
// listener; back to `idle` only after a rejection so a retry can re-register.
// The `pending` gate is what prevents a duplicate listener: while one
// registration is in flight a concurrent caller never starts a second.
type BridgeState = 'idle' | 'pending' | 'live'
let bridgeState: BridgeState = 'idle'

// One focus event fans out to every current subscriber. Hoisted so the same
// handler identity feeds each (re)registration.
const handleFocusChanged = ({
	payload: focused,
}: {
	payload: boolean
}): void => {
	if (!focused) return
	for (const notify of focusSubscribers) notify()
}

// Cap self-healing so a permanently-broken bridge (e.g. window gone) can't spin
// forever; each rejected registration burns one attempt.
const MAX_BRIDGE_ATTEMPTS = 3
let bridgeAttempts = 0

const startFocusBridge = (): void => {
	if (bridgeState !== 'idle') return
	if (bridgeAttempts >= MAX_BRIDGE_ATTEMPTS) return
	bridgeState = 'pending'
	bridgeAttempts += 1

	getCurrentWindow()
		.onFocusChanged(handleFocusChanged)
		.then(() => {
			bridgeState = 'live'
		})
		.catch((error: unknown) => {
			// The listener never attached, so dropping back to `idle` cannot
			// strand a live listener; the next subscriber retries (bounded).
			bridgeState = 'idle'
			const { message, stack } = describeError(error)
			logger.error(`appFocus: onFocusChanged failed: ${message}`, {
				scope: 'app-focus',
				details: { stack },
			})
		})
}

/**
 * Run `onFocus` whenever the app window regains focus — a reload-on-focus hook
 * for repo-scoped resources. Returns a synchronous unsubscribe that only
 * removes the callback from the in-memory set (never touching Tauri), so it is
 * safe to call repeatedly and across StrictMode remounts.
 */
export const onAppFocus = (onFocus: () => void): (() => void) => {
	startFocusBridge()
	focusSubscribers.add(onFocus)
	return () => {
		focusSubscribers.delete(onFocus)
	}
}

// Test-only escape hatch so suites can verify from a clean slate.
export const resetAppFocusForTests = (): void => {
	bridgeState = 'idle'
	bridgeAttempts = 0
	focusSubscribers.clear()
}
