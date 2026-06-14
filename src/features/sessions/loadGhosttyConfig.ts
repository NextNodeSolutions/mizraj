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
// still come up with its defaults. A null/undefined payload (an IPC that
// resolves without a config) collapses to the same fallback, so every consumer
// downstream gets a fully-shaped config and never dereferences null.
export const loadGhosttyConfig = async (
	appearance: Appearance,
): Promise<GhosttyConfig> => {
	try {
		const config = await invoke<GhosttyConfig | null>(LOAD_COMMAND, {
			appearance,
		})
		return config ?? EMPTY_CONFIG
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.warn(`loadGhosttyConfig: invoke failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, appearance },
		})
		return EMPTY_CONFIG
	}
}
