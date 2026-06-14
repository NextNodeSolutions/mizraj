import { invoke } from '@tauri-apps/api/core'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/**
 * End a session's PTY (Ghostty close_surface). The single seam over the
 * `session_close` command — callers layer their own follow-up (a toast, pruning
 * the split tree) but never re-implement the IPC + error log. Resolves true on
 * success, false on a logged failure.
 */
export const closeSession = async (sessionId: string): Promise<boolean> => {
	try {
		await invoke('session_close', { sessionId })
		return true
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`closeSession: session_close failed: ${message}`, {
			scope: 'sessions',
			details: { stack, sessionId },
		})
		return false
	}
}
