import { listen } from '@tauri-apps/api/event'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

// Mirror of the backend constant (src-tauri/src/ghostty/watch.rs): broadcast
// whenever the Ghostty config changes on disk (debounced).
export const GHOSTTY_CONFIG_CHANGED_EVENT = 'ghostty:config-changed'

// Bumped once per on-disk config change. Consumers depend on it (effect deps,
// cache keys) to re-pull the resolved config: the value itself carries no
// meaning, only its change does.
export const ghosttyConfigEpochAtom = atom(0)

let bridgeStarted = false

// Single app-wide listener turning the backend's config-changed broadcast into
// an epoch bump (same idempotent-bridge pattern as startAgentEventsBridge).
// Call once at startup; safe to call again (e.g. React StrictMode double-run).
export const startGhosttyConfigBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	const store = getDefaultStore()

	listen(GHOSTTY_CONFIG_CHANGED_EVENT, () => {
		store.set(ghosttyConfigEpochAtom, store.get(ghosttyConfigEpochAtom) + 1)
	}).catch((error: unknown) => {
		bridgeStarted = false
		const { message, stack } = describeError(error)
		logger.error(
			`startGhosttyConfigBridge: listen('${GHOSTTY_CONFIG_CHANGED_EVENT}') failed: ${message}`,
			{ scope: 'ghostty-config', details: { stack } },
		)
	})
}

// Test-only escape hatch so suites can verify idempotency from a clean slate.
export const resetGhosttyConfigBridgeForTests = (): void => {
	bridgeStarted = false
}
