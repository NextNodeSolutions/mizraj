import { invoke } from '@tauri-apps/api/core'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { readClipboardText, writeClipboardText } from './clipboard'
import { closeSession } from './closeSession'
import type {
	Keybind,
	KeybindAction,
	OptionAsAlt,
	SplitDirection,
	SplitFocus,
} from './ghosttyConfig'
import { extractGridText } from './gridText'
import { defaultShell, spawnSession } from './launchSession'
import { activeSessionIdAtom, cellFramesAtom, sessionsAtom } from './sessions'
import type { SplitNode } from './splitLayout'
import {
	findRootId,
	insertSplit,
	leaf,
	neighborLeaf,
	removeSessionFromSplits,
	splitTreesAtom,
} from './splitLayout'

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

// Which Option side(s) act as Alt/Meta (macos-option-as-alt). Seeded with the
// keybind table by useGhosttyTheme; the input router reads it live.
export const optionAsAltAtom = atom<OptionAsAlt>('none')

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
	invoke('session_scroll', { sessionId, request }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`keybind scroll: session_scroll failed: ${message}`, {
			scope: 'terminal-input',
			details: { stack, sessionId },
		})
	})
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

// The tree the session lives in: the entry that contains it, else the session
// standing alone as its own (implicit) single-leaf view.
const treeFor = (sessionId: string): { rootId: string; tree: SplitNode } => {
	const trees = getDefaultStore().get(splitTreesAtom)
	const rootId = findRootId(trees, sessionId) ?? sessionId
	return { rootId, tree: trees[rootId] ?? leaf(rootId) }
}

// Spawn a shell next to the pane and graft it into the view's tree. The shell
// inherits the source session's repo as cwd; a session launched before repo
// tracking (or a failed spawn) logs and leaves the layout untouched.
const openSplit = (sessionId: string, direction: SplitDirection): void => {
	void (async () => {
		const store = getDefaultStore()
		const repoPath = store.get(sessionsAtom)[sessionId]?.repoPath
		if (!repoPath) {
			logger.warn('new_split: no repo path for session; skipping', {
				scope: 'terminal-input',
				details: { sessionId },
			})
			return
		}
		const binary = await defaultShell()
		const created = await spawnSession({ binary, repoPath })
		if (created === null) return
		const { rootId, tree } = treeFor(sessionId)
		store.set(splitTreesAtom, {
			...store.get(splitTreesAtom),
			[rootId]: insertSplit(tree, sessionId, created, direction),
		})
	})()
}

const gotoSplit = (sessionId: string, focus: SplitFocus): void => {
	const { tree } = treeFor(sessionId)
	const neighbor = neighborLeaf(tree, sessionId, focus)
	if (neighbor) getDefaultStore().set(activeSessionIdAtom, neighbor)
}

// Ghostty's close_surface: end the pane's session and collapse its slot. The
// AGENT_END listener also prunes the tree, but pruning here too keeps the
// layout snappy instead of waiting on the child's exit round-trip.
const closeSurface = (sessionId: string): void => {
	void closeSession(sessionId)
	removeSessionFromSplits(sessionId)
}

// The `performable:` contract (TP8): a binding that cannot act right now must
// let its key fall through to the PTY instead of consuming it. Only
// split-navigation is state-dependent today.
export const canPerformKeybindAction = (
	action: KeybindAction,
	context: KeybindContext,
): boolean => {
	if (action.kind !== 'goto_split') return true
	const { tree } = treeFor(context.sessionId)
	return neighborLeaf(tree, context.sessionId, action.focus) !== null
}

// Actions that need nothing but the target session, dispatched by lookup so
// the switch below only carries the parameterized cases.
const SESSION_ACTIONS: Partial<
	Record<KeybindAction['kind'], (sessionId: string) => void>
> = {
	copy_to_clipboard: copyToClipboard,
	select_all: selectAll,
	paste_from_clipboard: pasteFromClipboard,
	paste_from_selection: pasteFromSelection,
	clear_screen: sessionId => writeToSession(sessionId, FORM_FEED),
	scroll_to_top: sessionId => scrollSession(sessionId, 'top'),
	scroll_to_bottom: sessionId => scrollSession(sessionId, 'bottom'),
	scroll_page_up: sessionId => scrollSession(sessionId, 'page_up'),
	scroll_page_down: sessionId => scrollSession(sessionId, 'page_down'),
	reset: resetTerminal,
	close_surface: closeSurface,
}

// Execute one matched keybind action. The matched key never reaches the PTY
// as a keystroke — a bound key must act bound (swallowing ctrl+c that the
// user bound to copy beats sending SIGINT to their shell).
export const executeKeybindAction = (
	action: KeybindAction,
	context: KeybindContext,
): void => {
	const sessionAction = SESSION_ACTIONS[action.kind]
	if (sessionAction) {
		sessionAction(context.sessionId)
		return
	}
	switch (action.kind) {
		case 'increase_font_size':
			shiftFontSize(action.amount)
			return
		case 'decrease_font_size':
			shiftFontSize(-action.amount)
			return
		case 'reset_font_size':
			resetFontSize()
			return
		case 'text':
			writeToSession(context.sessionId, action.text)
			return
		case 'esc':
			writeToSession(context.sessionId, `${ESC}${action.sequence}`)
			return
		case 'new_split':
			openSplit(context.sessionId, action.direction)
			return
		case 'goto_split':
			gotoSplit(context.sessionId, action.focus)
			return
		default:
			// ignore / unsupported: consume the key, do nothing.
			return
	}
}
