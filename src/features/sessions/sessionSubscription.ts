import { invoke } from '@tauri-apps/api/core'

import { describeError, isSessionError } from '@/shared/errors'
import { logger } from '@/shared/logger'

// `not_found` is the normal teardown race (the session ended before the pane
// released it), so it logs at debug; anything else is a real wiring problem.
const flipSubscription = (command: string, sessionId: string): void => {
	invoke(command, { sessionId }).catch((error: unknown) => {
		if (isSessionError(error) && error.kind === 'not_found') {
			logger.debug(
				`sessionSubscription: ${command} skipped, session gone (expected during teardown)`,
				{ scope: 'terminal-pane', details: { sessionId } },
			)
			return
		}

		const { message, stack } = describeError(error)
		logger.warn(`sessionSubscription: ${command} failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, sessionId },
		})
	})
}

// Tell the backend a pane is watching this session, so its terminal sink emits
// cell frames (TP3: unwatched sessions skip snapshot/serialize/IPC entirely).
// Returns the release to call on unmount; both directions are fire-and-forget
// because frame delivery, not the ack, is the observable effect.
export const subscribeToCellFrames = (sessionId: string): (() => void) => {
	flipSubscription('session_subscribe', sessionId)
	return () => {
		flipSubscription('session_unsubscribe', sessionId)
	}
}
