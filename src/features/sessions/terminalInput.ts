import { invoke } from '@tauri-apps/api/core'
import { getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { KeybindAction } from './ghosttyConfig'
import type { KeyInput, MatchResult } from './keybindMatcher'
import { createKeybindMatcher } from './keybindMatcher'
import type { KeybindContext } from './keybindRuntime'
import { executeKeybindAction, keybindTableAtom } from './keybindRuntime'
import { activeSessionIdAtom } from './sessions'

// Raw keystroke DTO mirroring the `session_key` serde struct on the Rust side.
// libghostty owns all VT encoding now, so the frontend ships physical key data
// untouched. Field names are the wire contract — do not rename them.
type KeyStroke = {
	code: string
	text: string | null
	ctrl: boolean
	alt: boolean
	shift: boolean
}

// Lone modifier presses carry no input on their own; built once, not per keystroke.
const LONE_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

// The terminal is the app's centre of gravity: it claims every keystroke EXCEPT
// those a focused control legitimately owns — form fields type, buttons/links
// activate. Everything else (incl. the body when nothing is focused) flows to
// the active session.
const isInteractiveTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	return target.matches(
		'input, textarea, select, button, a[href], [role="button"], [role="textbox"]',
	)
}

const propagateKey = (sessionId: string, stroke: KeyStroke): void => {
	invoke('session_key', { sessionId, stroke }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`terminalInput: session_key failed: ${message}`, {
			scope: 'terminal-input',
			details: { stack, sessionId },
		})
	})
}

// The KeyboardEvent surface the route consumes — narrowed for testability.
export type RoutedKeydown = {
	key: string
	code: string
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
	metaKey: boolean
	target: EventTarget | null
	preventDefault: () => void
}

type RouteDeps = {
	activeSessionId: () => string | null
	feed: (input: KeyInput) => MatchResult
	execute: (action: KeybindAction, context: KeybindContext) => void
	propagate: (sessionId: string, stroke: KeyStroke) => void
}

// Decide one keydown's fate (TP8), in order: keybind dispatch first — a
// matched action executes with zero bytes to the PTY, a pending/aborted
// sequence consumes the key — then the PTY encoder as the fallback. Unbound
// cmd/super keys stay with the app/OS (never encoded), preserving the
// pre-keybind behavior.
export const createKeydownRoute =
	(deps: RouteDeps) =>
	(event: RoutedKeydown): void => {
		if (LONE_MODIFIER_KEYS.has(event.key)) return
		if (isInteractiveTarget(event.target)) return
		const sessionId = deps.activeSessionId()
		if (!sessionId) return

		const result = deps.feed({
			key: event.key,
			code: event.code,
			shift: event.shiftKey,
			ctrl: event.ctrlKey,
			alt: event.altKey,
			super: event.metaKey,
		})

		if (result.kind === 'action') {
			event.preventDefault()
			deps.execute(result.action, { sessionId })
			return
		}
		if (result.kind === 'pending' || result.kind === 'abort') {
			event.preventDefault()
			return
		}

		// Unbound: cmd/super belongs to the app/OS, everything else is the
		// active terminal's keystroke (Tab/Space/arrows must not scroll the
		// page or move focus).
		if (event.metaKey) return
		event.preventDefault()
		deps.propagate(sessionId, {
			code: event.code,
			text: event.key.length === 1 ? event.key : null,
			ctrl: event.ctrlKey,
			alt: event.altKey,
			shift: event.shiftKey,
		})
	}

let routerStarted = false

// One window-level keydown listener routes every keystroke to whichever pane is
// active (activeSessionIdAtom), read live from the default store so it always
// targets the current pane — never broadcasting to all of them. The keybind
// matcher rebuilds whenever the config's table changes (first load, hot
// reload). Idempotent and started once from main.tsx, mirroring
// startAgentEventsBridge.
export const startTerminalInputRouter = (): void => {
	if (routerStarted) return
	routerStarted = true

	const store = getDefaultStore()

	let matcher = createKeybindMatcher(store.get(keybindTableAtom))
	store.sub(keybindTableAtom, () => {
		matcher = createKeybindMatcher(store.get(keybindTableAtom))
	})

	const route = createKeydownRoute({
		activeSessionId: () => store.get(activeSessionIdAtom),
		feed: input => matcher.feed(input),
		execute: executeKeybindAction,
		propagate: propagateKey,
	})

	window.addEventListener('keydown', route)
}
