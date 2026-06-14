import { invoke } from '@tauri-apps/api/core'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { Appearance, GhosttyConfig } from './ghosttyConfig'
import { EMPTY_CONFIG } from './ghosttyConfig'

const LOAD_COMMAND = 'load_ghostty_config'

// The IO adapter over `load_ghostty_config`, kept apart from the pure resolvers
// in ghosttyConfig.ts (which must stay free of the Tauri import to be testable).
// The backend command never throws (bad config rides along in `diagnostics`),
// so the only failure here is the IPC bridge itself being unavailable. We log
// it and hand back the empty config rather than rejecting: the terminal must
// still come up with its defaults.
export const loadGhosttyConfig = async (
	appearance: Appearance,
): Promise<GhosttyConfig> => {
	try {
		return await invoke<GhosttyConfig>(LOAD_COMMAND, { appearance })
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.warn(`loadGhosttyConfig: invoke failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, appearance },
		})
		return EMPTY_CONFIG
	}
}
