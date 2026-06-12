import { invoke } from '@tauri-apps/api/core'

import { describeError, isSessionError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { CellFramePayload } from './terminalWire'

// Expected absences: the session ended before the pull landed, or it carries
// no terminal sink. The pane simply stays on whatever the live flow brings.
const isFrameAbsence = (error: unknown): boolean =>
	isSessionError(error) &&
	(error.kind === 'not_found' || error.kind === 'frame_unavailable')

// Pull the session's current grid (TP1): invoked right after subscribing so a
// remounted pane paints instantly — idle sessions included — instead of
// waiting for the next live frame. Resolves null when no frame is available;
// the caller treats the pull as best-effort seeding.
export const fetchSessionFrame = async (
	sessionId: string,
): Promise<CellFramePayload | null> => {
	try {
		return await invoke<CellFramePayload>('session_get_frame', {
			sessionId,
		})
	} catch (error: unknown) {
		if (isFrameAbsence(error)) return null

		const { message, stack } = describeError(error)
		logger.warn(`fetchSessionFrame: session_get_frame failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, sessionId },
		})
		return null
	}
}
