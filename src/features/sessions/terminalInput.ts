import { invoke } from '@tauri-apps/api/core'
import { getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { KeybindAction } from './ghosttyConfig'
import type { KeyInput, MatchResult } from './keybindMatcher'
import { createKeybindMatcher } from './keybindMatcher'
import type { KeybindContext } from './keybindRuntime'
import {
	canPerformKeybindAction,
	executeKeybindAction,
	keybindTableAtom,
	optionAsAltAtom,
} from './keybindRuntime'
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

// W3C legacy keyCode value meaning "processed by the input method".
const IME_PROCESSED_KEYCODE = 229

// Lone modifier presses carry no input on their own; built once, not per keystroke.
const LONE_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

// The composer (hidden textarea) is interactive by tag but belongs to the
// terminal — exempted via this dataset flag.
const COMPOSER_FLAG = 'mizrajTerminalInput'

// The terminal is the app's centre of gravity: it claims every keystroke EXCEPT
// those a focused control legitimately owns — form fields type, buttons/links
// activate. Everything else (incl. the body when nothing is focused) flows to
// the active session.
const isInteractiveTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.dataset[COMPOSER_FLAG] !== undefined) return false
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
	/// Legacy keyCode, kept for ONE signal: 229 marks a keydown the OS text
	/// input system already consumed (dead-key commit, IME) — observed in
	/// WebKit as e.g. `key:"'", code:"Space", keyCode:229` fired AFTER the
	/// compositionend that delivered the apostrophe. No modern field carries
	/// this; xterm.js gates on the same value.
	keyCode: number
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
	metaKey: boolean
	isComposing?: boolean
	target: EventTarget | null
	preventDefault: () => void
}

type RouteDeps = {
	activeSessionId: () => string | null
	feed: (input: KeyInput) => MatchResult
	execute: (action: KeybindAction, context: KeybindContext) => void
	canPerform: (action: KeybindAction, context: KeybindContext) => boolean
	propagate: (sessionId: string, stroke: KeyStroke) => void
	/// Whether the Option side currently held acts as Alt/Meta
	/// (macos-option-as-alt × live left/right state). False = Option composes
	/// layout characters, the macOS default.
	altIsMeta: () => boolean
	/// Whether the hidden composer owns printable input right now (it is the
	/// focused element). When true, printable keys are left alone so the OS
	/// composes them (dead keys, option chars, IME) and `beforeinput` delivers.
	composerActive: () => boolean
	/// Abandon any in-flight composition in the composer WITHOUT committing its
	/// text — used when a keybind fires on a dead-key chord (option+n) so the
	/// pending dead char never reaches the PTY.
	cancelComposition: () => void
	/// Whether the composer holds in-flight text (a dead key or IME composition
	/// awaiting its commit). While true, every printable key must reach the
	/// composer — on US-International, the space after a dead `'` IS the commit
	/// keystroke; encoding it directly would double-deliver (`' ` instead of `'`).
	composerBusy: () => boolean
}

// An unbound key's fate: cmd/super belongs to the app/OS, a dead key to the
// composer (its commit comes back via composition); ctrl chords, alt-as-meta
// chords and non-printable keys (Enter, Tab, arrows, …) encode against the
// terminal modes backend-side — alt-as-meta drops the (composed) text so the
// encoder derives ESC-prefix sequences from the logical key, like Ghostty with
// macos-option-as-alt. Printable text goes to the focused composer (the OS
// composes it, `beforeinput`/`compositionend` deliver), or encodes directly
// when focus drifted to the body — option-composed characters then ride as
// plain text (alt:false), Ghostty's default.
const routeUnboundKey = (
	deps: RouteDeps,
	event: RoutedKeydown,
	sessionId: string,
): void => {
	if (event.metaKey) return
	if (event.key === 'Dead') return
	// The OS text input system already owns this keydown (keyCode 229): its
	// text was/will be delivered through the composer's composition events.
	// Encoding it here would double-deliver — `'`+space on US-International
	// commits the apostrophe via compositionend AND fires this keydown.
	if (event.keyCode === IME_PROCESSED_KEYCODE) return

	const printable = [...event.key].length === 1
	const altIsMeta = event.altKey && deps.altIsMeta()

	if (event.ctrlKey || altIsMeta || !printable) {
		event.preventDefault()
		deps.propagate(sessionId, {
			code: event.code,
			text: printable && !altIsMeta ? event.key : null,
			ctrl: event.ctrlKey,
			alt: altIsMeta,
			shift: event.shiftKey,
		})
		return
	}

	// Word-boundary characters (space, punctuation, digits) are exactly what
	// macOS autocorrect/inline prediction buffers in a composition inside the
	// composer, deferring delivery until the NEXT keystroke commits it. They
	// can never START a composition themselves (a dead key arrives as key
	// "Dead"), so they encode directly — UNLESS one is already in flight
	// (composerBusy): then this keystroke may be its commit (dead `'` + space
	// = `'` on US-International) and must reach the composer. Letters always
	// stay with the composer: press-and-hold accents and dead-key sequences
	// need the OS text machinery.
	if (
		deps.composerActive() &&
		(deps.composerBusy() || /\p{L}/u.test(event.key))
	) {
		return
	}
	event.preventDefault()
	deps.propagate(sessionId, {
		code: event.code,
		text: event.key,
		ctrl: false,
		alt: false,
		shift: event.shiftKey,
	})
}

// Decide one keydown's fate (TP8), in order: keybind dispatch first — a
// matched action executes with zero bytes to the PTY (a `performable:` binding
// that cannot act falls through instead), a pending/aborted sequence consumes
// the key — then text composition or the PTY encoder via routeUnboundKey.
export const createKeydownRoute =
	(deps: RouteDeps) =>
	(event: RoutedKeydown): void => {
		// The IME owns the stream mid-composition; its commit arrives through
		// the composer's composition/beforeinput events, never as keystrokes.
		// EXCEPT modifier chords: a dead-key chord (option+n → dead "~") makes
		// WebKit fire compositionstart BEFORE the chord's own keydown, so an
		// alt/ctrl binding must still reach the matcher mid-composition.
		if (event.isComposing && !event.ctrlKey && !event.altKey) return
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
			const context = { sessionId }
			if (
				!result.performable ||
				deps.canPerform(result.action, context)
			) {
				event.preventDefault()
				// A dead-key chord already opened a composition (or will,
				// since the dead char was pressed): drop it so the pending
				// "~"-style char never commits to the PTY.
				if (event.isComposing || event.key === 'Dead') {
					deps.cancelComposition()
				}
				deps.execute(result.action, context)
				return
			}
			// performable + not actionable: fall through like an unbound key.
		} else if (result.kind === 'pending' || result.kind === 'abort') {
			event.preventDefault()
			return
		}

		if (event.isComposing) return
		routeUnboundKey(deps, event, sessionId)
	}

// Deliver committed text to the active session, one Unicode scalar per
// keystroke: the backend encoder accepts a single printable scalar and a
// commit is at most a few (composed char, quote+letter, IME word).
const deliverComposedText = (
	activeSessionId: () => string | null,
	text: string,
): void => {
	const sessionId = activeSessionId()
	if (!sessionId) return
	for (const scalar of text) {
		propagateKey(sessionId, {
			code: 'Unidentified',
			text: scalar,
			ctrl: false,
			alt: false,
			shift: false,
		})
	}
}

// The hidden composer: a real text field so macOS runs its input machinery
// (dead keys, press-and-hold accents, IME) against the terminal. It never
// accumulates content — every insertion is intercepted and forwarded.
type Composer = {
	element: HTMLTextAreaElement
	/// Abandon an in-flight composition without committing its text.
	cancelComposition: () => void
	/// Whether a composition (dead key, IME) is awaiting its commit.
	busy: () => boolean
}

const createComposer = (activeSessionId: () => string | null): Composer => {
	const composer = document.createElement('textarea')
	composer.dataset[COMPOSER_FLAG] = 'true'
	composer.setAttribute('aria-label', 'Terminal input')
	composer.autocapitalize = 'off'
	composer.autocomplete = 'off'
	composer.spellcheck = false
	// WebKit-specific switches: without them macOS autocorrect/inline
	// prediction wraps plain keystrokes (notably the space ending a word) in a
	// composition, deferring delivery until the next keypress commits it.
	composer.setAttribute('autocorrect', 'off')
	composer.setAttribute('writingsuggestions', 'false')
	composer.tabIndex = -1
	composer.style.position = 'fixed'
	composer.style.left = '0'
	composer.style.bottom = '0'
	composer.style.width = '1px'
	composer.style.height = '1px'
	composer.style.opacity = '0'
	composer.style.border = 'none'
	composer.style.padding = '0'
	composer.style.zIndex = '-1'

	composer.addEventListener('beforeinput', (event: Event) => {
		if (!(event instanceof InputEvent)) return
		// Mid-composition updates are not cancelable; the commit arrives once,
		// via compositionend.
		if (event.inputType === 'insertCompositionText') return
		event.preventDefault()
		if (event.inputType === 'insertText' && event.data) {
			deliverComposedText(activeSessionId, event.data)
			return
		}
		// Press-and-hold accent picker: the base char was already sent when
		// typed, the replacement swaps it — approximate with backspace + text.
		if (event.inputType === 'insertReplacementText' && event.data) {
			const sessionId = activeSessionId()
			if (!sessionId) return
			propagateKey(sessionId, {
				code: 'Backspace',
				text: null,
				ctrl: false,
				alt: false,
				shift: false,
			})
			deliverComposedText(activeSessionId, event.data)
		}
	})

	// Cancellation path: blurring the composer makes WebKit COMMIT the pending
	// composition (compositionend with data), so the flag swallows that one
	// commit. `composing` guards the flag so a cancel outside a composition can
	// never eat a future legitimate commit.
	let composing = false
	let suppressCommit = false
	composer.addEventListener('compositionstart', () => {
		composing = true
	})
	composer.addEventListener('compositionend', (event: CompositionEvent) => {
		composing = false
		if (suppressCommit) {
			suppressCommit = false
		} else if (event.data) {
			deliverComposedText(activeSessionId, event.data)
		}
		composer.value = ''
	})

	const cancelComposition = (): void => {
		composer.value = ''
		if (!composing || document.activeElement !== composer) return
		suppressCommit = true
		composer.blur()
		composer.focus({ preventScroll: true })
	}

	// `composing` covers implementations that fire composition events for dead
	// keys; the value check covers any that only stage marked text (every
	// committed insertion is prevented or cleared, so a non-empty value can
	// only be in-flight composition text).
	const busy = (): boolean => composing || composer.value !== ''

	return { element: composer, cancelComposition, busy }
}

let routerStarted = false

// One window-level keydown listener routes every keystroke to whichever pane is
// active (activeSessionIdAtom), read live from the default store so it always
// targets the current pane — never broadcasting to all of them. The keybind
// matcher rebuilds whenever the config's table changes (first load, hot
// reload). Alongside it lives the hidden composer, which adopts focus whenever
// nothing interactive holds it so printable input goes through the OS text
// machinery instead of raw keycodes. Idempotent and started once from
// main.tsx, mirroring startAgentEventsBridge.
export const startTerminalInputRouter = (): void => {
	if (routerStarted) return
	routerStarted = true

	const store = getDefaultStore()
	const activeSessionId = (): string | null => store.get(activeSessionIdAtom)

	let matcher = createKeybindMatcher(store.get(keybindTableAtom))
	store.sub(keybindTableAtom, () => {
		matcher = createKeybindMatcher(store.get(keybindTableAtom))
	})

	const {
		element: composer,
		cancelComposition,
		busy: composerBusy,
	} = createComposer(activeSessionId)
	document.body.appendChild(composer)

	// Which Option side is physically down: KeyboardEvent.altKey can't say, so
	// the sides are tracked from the modifier's own keydown/keyup location and
	// cleared when the window blurs mid-press.
	let leftAltDown = false
	let rightAltDown = false
	const trackAltSide = (event: KeyboardEvent, down: boolean): void => {
		if (event.key !== 'Alt') return
		if (event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT) {
			rightAltDown = down
		} else {
			leftAltDown = down
		}
	}
	const altIsMeta = (): boolean => {
		switch (store.get(optionAsAltAtom)) {
			case 'both':
				return true
			case 'left':
				return leftAltDown
			case 'right':
				return rightAltDown
			default:
				return false
		}
	}

	// Focus follows the terminal: whenever focus lands on nothing (the body),
	// the composer adopts it so the next keystroke composes. Anything truly
	// interactive (palette, forms) keeps focus — the router already defers to
	// it — and the composer reclaims on the way back.
	const syncComposerFocus = (): void => {
		const active = document.activeElement
		const idle = !active || active === document.body || active === composer
		if (idle && activeSessionId() !== null && active !== composer) {
			composer.focus({ preventScroll: true })
		}
	}
	const syncSoon = (): void => {
		setTimeout(syncComposerFocus, 0)
	}

	const route = createKeydownRoute({
		activeSessionId,
		feed: input => matcher.feed(input),
		execute: executeKeybindAction,
		canPerform: canPerformKeybindAction,
		propagate: propagateKey,
		altIsMeta,
		composerActive: () => document.activeElement === composer,
		cancelComposition,
		composerBusy,
	})

	window.addEventListener('keydown', event => {
		trackAltSide(event, true)
		route(event)
	})
	window.addEventListener('keyup', event => {
		trackAltSide(event, false)
	})
	window.addEventListener('blur', () => {
		leftAltDown = false
		rightAltDown = false
	})
	window.addEventListener('focus', syncSoon)
	document.addEventListener('click', syncSoon)
	// Document-level so ANY field handing focus back to the body returns the
	// keyboard to the terminal — the palette's Escape/⌘K close and other
	// keyboard-only dismissals never produce a click or window refocus.
	document.addEventListener('focusout', syncSoon)
	store.sub(activeSessionIdAtom, syncSoon)
	syncComposerFocus()
}
