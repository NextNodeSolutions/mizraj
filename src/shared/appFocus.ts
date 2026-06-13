import { getCurrentWindow } from '@tauri-apps/api/window'

import { describeError } from './errors'
import { logger } from './logger'

// Subscribers notified each time the app window regains focus. A single
// `onFocusChanged` bridge feeds them all: it is registered once and never torn
// down (like the agent-events and split-lifecycle bridges), so no per-mount
// `unlisten()` ever races Tauri's internal listener map under React.StrictMode.
const focusSubscribers = new Set<() => void>()

let bridgeStarted = false

const startFocusBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	getCurrentWindow()
		.onFocusChanged(({ payload: focused }) => {
			if (!focused) return
			for (const notify of focusSubscribers) notify()
		})
		.catch((error: unknown) => {
			bridgeStarted = false
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
	bridgeStarted = false
	focusSubscribers.clear()
}
