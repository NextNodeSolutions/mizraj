import { listen } from '@tauri-apps/api/event'
import { getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import {
	AGENT_CELLS_EVENT,
	AGENT_END_EVENT,
	AGENT_TITLE_EVENT,
	endSessionAtom,
	sessionsAtom,
	setCellFrameAtom,
	setSessionTitleAtom,
} from './sessions'
import type { SessionEndPayload, TitlePayload } from './sessions'
import type { CellFramePayload } from './terminalWire'

let bridgeStarted = false

// Idempotent — safe to call multiple times even though main.tsx only calls
// once; HMR + tests can re-import without double-subscribing.
export const startAgentEventsBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	const store = getDefaultStore()

	// Subscribe to a per-session Tauri event, dropping (with a warning) any
	// payload whose session we don't know about, and resetting the bridge on a
	// failed subscription so a later startAgentEventsBridge() can retry.
	const forwardSessionEvent = <T extends { session_id: string }>(
		event: string,
		route: (payload: T) => void,
	): void => {
		listen<T>(event, ({ payload }) => {
			if (!store.get(sessionsAtom)[payload.session_id]) {
				logger.warn(
					`${event} for unknown session ${payload.session_id}; dropping`,
					{ scope: 'sessions-store' },
				)
				return
			}
			route(payload)
		}).catch((error: unknown) => {
			bridgeStarted = false
			const { message, stack } = describeError(error)
			logger.error(
				`startAgentEventsBridge: listen('${event}') failed: ${message}`,
				{ scope: 'sessions-store', details: { stack } },
			)
		})
	}

	forwardSessionEvent<SessionEndPayload>(
		AGENT_END_EVENT,
		({ session_id, exit_code }) => {
			store.set(endSessionAtom, {
				sessionId: session_id,
				exitCode: exit_code,
			})
		},
	)

	forwardSessionEvent<CellFramePayload>(AGENT_CELLS_EVENT, frame => {
		store.set(setCellFrameAtom, frame)
	})

	forwardSessionEvent<TitlePayload>(
		AGENT_TITLE_EVENT,
		({ session_id, title }) => {
			store.set(setSessionTitleAtom, { sessionId: session_id, title })
		},
	)
}

// Test-only escape hatch so suites can verify idempotency from a clean slate.
export const resetAgentEventsBridgeForTests = (): void => {
	bridgeStarted = false
}
