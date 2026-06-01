import { invoke } from '@tauri-apps/api/core'
import { getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

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

let routerStarted = false

// One window-level keydown listener routes every keystroke to whichever pane is
// active (activeSessionIdAtom), read live from the default store so it always
// targets the current pane — never broadcasting to all of them. Idempotent and
// started once from main.tsx, mirroring startAgentEventsBridge.
export const startTerminalInputRouter = (): void => {
	if (routerStarted) return
	routerStarted = true

	const store = getDefaultStore()

	window.addEventListener('keydown', event => {
		// Cmd/Super belongs to the app/OS; lone modifiers carry no input.
		if (event.metaKey || LONE_MODIFIER_KEYS.has(event.key)) return
		// A focused control owns its own keystroke; don't hijack it.
		if (isInteractiveTarget(event.target)) return
		// No active pane → leave the keystroke to the app (shortcuts, etc.).
		const sessionId = store.get(activeSessionIdAtom)
		if (!sessionId) return
		// The active terminal owns the keystroke: Tab/Space/arrows must not
		// scroll the page or move focus.
		event.preventDefault()
		propagateKey(sessionId, {
			code: event.code,
			text: event.key.length === 1 ? event.key : null,
			ctrl: event.ctrlKey,
			alt: event.altKey,
			shift: event.shiftKey,
		})
	})
}
