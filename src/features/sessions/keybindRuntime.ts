import { atom } from 'jotai'

import { logger } from '@/shared/logger'

import type { Keybind, KeybindAction } from './ghosttyConfig'

// The folded keybind table of the active config. Seeded by the render-bundle
// path (useTerminalCanvas) and re-set on hot reload; the input router rebuilds
// its matcher when this changes. Identity-stable across cache hits, so
// redundant seeds don't churn the matcher.
export const keybindTableAtom = atom<Keybind[]>([])

export type KeybindContext = {
	sessionId: string
}

// Execute one matched keybind action. The matched key never reaches the PTY —
// even for actions not wired yet (a bound key must act bound: swallowing
// ctrl+c that the user bound to copy beats sending SIGINT to their shell).
// Handlers are filled in by their milestone slices (copy/paste/select-all,
// then font-size/clear/reset/text/esc).
export const executeKeybindAction = (
	action: KeybindAction,
	context: KeybindContext,
): void => {
	switch (action.kind) {
		case 'ignore':
		case 'unsupported':
			return
		case 'copy_to_clipboard':
		case 'paste_from_clipboard':
		case 'paste_from_selection':
		case 'select_all':
		case 'increase_font_size':
		case 'decrease_font_size':
		case 'reset_font_size':
		case 'clear_screen':
		case 'reset':
		case 'text':
		case 'esc':
			logger.debug(`keybind action not wired yet: ${action.kind}`, {
				scope: 'terminal-input',
				details: { sessionId: context.sessionId },
			})
			return
	}
}
