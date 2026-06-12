import { invoke } from '@tauri-apps/api/core'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { readClipboardText, writeClipboardText } from './clipboard'
import type { Keybind, KeybindAction } from './ghosttyConfig'
import { extractGridText } from './gridText'
import { cellFramesAtom } from './sessions'

// The folded keybind table of the active config. Seeded by the render-bundle
// path (useTerminalCanvas) and re-set on hot reload; the input router rebuilds
// its matcher when this changes. Identity-stable across cache hits, so
// redundant seeds don't churn the matcher.
export const keybindTableAtom = atom<Keybind[]>([])

// The current selection text per session. select-all fills it with the whole
// visible grid; M13's mouse selection will drive it from the drag model. copy
// and paste_from_selection read it, falling back to grid/clipboard.
export const sessionSelectionAtom = atom<Readonly<Record<string, string>>>({})

export type KeybindContext = {
	sessionId: string
}

const visibleGridText = (sessionId: string): string | null => {
	const frame = getDefaultStore().get(cellFramesAtom)[sessionId]
	return frame ? extractGridText(frame) : null
}

const selectionText = (sessionId: string): string | null =>
	getDefaultStore().get(sessionSelectionAtom)[sessionId] ?? null

const copyToClipboard = (sessionId: string): void => {
	const text = selectionText(sessionId) ?? visibleGridText(sessionId)
	if (!text) return
	void writeClipboardText(text)
}

const selectAll = (sessionId: string): void => {
	const text = visibleGridText(sessionId)
	if (text === null) return
	const store = getDefaultStore()
	store.set(sessionSelectionAtom, {
		...store.get(sessionSelectionAtom),
		[sessionId]: text,
	})
}

// Inject pasted text through the backend, which encodes it against the live
// bracketed-paste mode before it reaches the PTY.
const pasteIntoSession = (sessionId: string, text: string | null): void => {
	if (!text) return
	invoke('session_paste', { sessionId, text }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`keybind paste: session_paste failed: ${message}`, {
			scope: 'terminal-input',
			details: { stack, sessionId },
		})
	})
}

const pasteFromClipboard = (sessionId: string): void => {
	void readClipboardText().then(text => {
		pasteIntoSession(sessionId, text)
	})
}

// Ghostty's paste_from_selection pastes the primary selection, falling back to
// the clipboard on platforms without one (our case once nothing is selected).
const pasteFromSelection = (sessionId: string): void => {
	const selected = selectionText(sessionId)
	if (selected) {
		pasteIntoSession(sessionId, selected)
		return
	}
	pasteFromClipboard(sessionId)
}

// Execute one matched keybind action. The matched key never reaches the PTY —
// even for actions not wired yet (a bound key must act bound: swallowing
// ctrl+c that the user bound to copy beats sending SIGINT to their shell).
// The remaining stubs are filled by the font-size/clear/reset/text/esc slice.
export const executeKeybindAction = (
	action: KeybindAction,
	context: KeybindContext,
): void => {
	switch (action.kind) {
		case 'ignore':
		case 'unsupported':
			return
		case 'copy_to_clipboard':
			copyToClipboard(context.sessionId)
			return
		case 'select_all':
			selectAll(context.sessionId)
			return
		case 'paste_from_clipboard':
			pasteFromClipboard(context.sessionId)
			return
		case 'paste_from_selection':
			pasteFromSelection(context.sessionId)
			return
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
