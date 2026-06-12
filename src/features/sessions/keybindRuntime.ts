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

// Interactive font-size offset (px ≡ pt here) applied on top of the config's
// size by increase/decrease_font_size; reset_font_size returns to 0. Kept as a
// delta so the executor needs no knowledge of the configured base size.
export const fontSizeDeltaAtom = atom(0)

// Ghostty's clear_screen also nudges the shell to redraw its prompt; a form
// feed is what ctrl+l sends and every shell answers it with a clear + redraw.
const FORM_FEED = '\f'
const ESC = '\u001b'

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

// Write keybind-injected bytes (text:/esc:/clear_screen) to the PTY verbatim
// via session_write — no paste encoding, the binding's bytes ARE the input.
const writeToSession = (sessionId: string, text: string): void => {
	invoke('session_write', { sessionId, text }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`keybind write: session_write failed: ${message}`, {
			scope: 'terminal-input',
			details: { stack, sessionId },
		})
	})
}

type ScrollRequest =
	| 'top'
	| 'bottom'
	| 'page_up'
	| 'page_down'
	| { delta: { rows: number } }

const scrollSession = (sessionId: string, request: ScrollRequest): void => {
	invoke('session_scroll', { sessionId, request }).catch(
		(error: unknown) => {
			const { message, stack } = describeError(error)
			logger.warn(`keybind scroll: session_scroll failed: ${message}`, {
				scope: 'terminal-input',
				details: { stack, sessionId },
			})
		},
	)
}

const resetTerminal = (sessionId: string): void => {
	invoke('session_reset', { sessionId }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`keybind reset: session_reset failed: ${message}`, {
			scope: 'terminal-input',
			details: { stack, sessionId },
		})
	})
}

const shiftFontSize = (delta: number): void => {
	const store = getDefaultStore()
	store.set(fontSizeDeltaAtom, store.get(fontSizeDeltaAtom) + delta)
}

const resetFontSize = (): void => {
	getDefaultStore().set(fontSizeDeltaAtom, 0)
}

// Execute one matched keybind action. The matched key never reaches the PTY
// as a keystroke — a bound key must act bound (swallowing ctrl+c that the
// user bound to copy beats sending SIGINT to their shell).
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
			shiftFontSize(action.amount)
			return
		case 'decrease_font_size':
			shiftFontSize(-action.amount)
			return
		case 'reset_font_size':
			resetFontSize()
			return
		case 'clear_screen':
			writeToSession(context.sessionId, FORM_FEED)
			return
		case 'scroll_to_top':
			scrollSession(context.sessionId, 'top')
			return
		case 'scroll_to_bottom':
			scrollSession(context.sessionId, 'bottom')
			return
		case 'scroll_page_up':
			scrollSession(context.sessionId, 'page_up')
			return
		case 'scroll_page_down':
			scrollSession(context.sessionId, 'page_down')
			return
		case 'reset':
			resetTerminal(context.sessionId)
			return
		case 'text':
			writeToSession(context.sessionId, action.text)
			return
		case 'esc':
			writeToSession(context.sessionId, `${ESC}${action.sequence}`)
			return
	}
}
