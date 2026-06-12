import type { Keybind, KeybindAction, KeyChord } from './ghosttyConfig'

// The keyboard fields the matcher consumes, normalized from a KeyboardEvent
// (`super` is the meta/cmd modifier).
export type KeyInput = {
	key: string
	code: string
	shift: boolean
	ctrl: boolean
	alt: boolean
	super: boolean
}

// What a keydown means once matched against the table:
// - action: a binding completed — execute it, the key never reaches the PTY
//   (`performable` rides along: such a binding only consumes the key when the
//   action can actually run — the router checks and falls through otherwise)
// - pending: a leader sequence is underway — consume the key and wait
// - abort: a sequence was interrupted — the interrupting key is swallowed
// - pass: no binding involved — encode to the PTY as usual
export type MatchResult =
	| { kind: 'action'; action: KeybindAction; performable: boolean }
	| { kind: 'pending' }
	| { kind: 'abort' }
	| { kind: 'pass' }

export type KeybindMatcher = {
	feed: (input: KeyInput) => MatchResult
}

// Ghostty named keys → KeyboardEvent.key values (the common set; F-keys are
// generated below). Single-character names compare directly and skip this map.
const NAMED_KEYS: Record<string, string> = {
	enter: 'Enter',
	escape: 'Escape',
	space: ' ',
	backspace: 'Backspace',
	tab: 'Tab',
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	right: 'ArrowRight',
	home: 'Home',
	end: 'End',
	page_up: 'PageUp',
	page_down: 'PageDown',
	delete: 'Delete',
	insert: 'Insert',
	caps_lock: 'CapsLock',
	plus: '+',
	minus: '-',
	equal: '=',
	period: '.',
	comma: ',',
	slash: '/',
	backslash: '\\',
	semicolon: ';',
	apostrophe: "'",
	grave_accent: '`',
	left_bracket: '[',
	right_bracket: ']',
	zero: '0',
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	six: '6',
	seven: '7',
	eight: '8',
	nine: '9',
}

for (let n = 1; n <= 25; n += 1) {
	NAMED_KEYS[`f${n}`] = `F${n}`
}

// Ghostty physical key names → KeyboardEvent.code values. Letters and digits
// are generated; the rest is the common punctuation/navigation set.
const PHYSICAL_CODES: Record<string, string> = {
	enter: 'Enter',
	escape: 'Escape',
	space: 'Space',
	backspace: 'Backspace',
	tab: 'Tab',
	minus: 'Minus',
	equal: 'Equal',
	left_bracket: 'BracketLeft',
	right_bracket: 'BracketRight',
	backslash: 'Backslash',
	semicolon: 'Semicolon',
	apostrophe: 'Quote',
	grave_accent: 'Backquote',
	comma: 'Comma',
	period: 'Period',
	slash: 'Slash',
}

for (let code = 97; code <= 122; code += 1) {
	const letter = String.fromCharCode(code)
	PHYSICAL_CODES[letter] = `Key${letter.toUpperCase()}`
}
const DIGIT_NAMES = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
]
for (const [digit, name] of DIGIT_NAMES.entries()) {
	PHYSICAL_CODES[name] = `Digit${digit}`
	PHYSICAL_CODES[`kp_${name}`] = `Numpad${digit}`
}

const logicalMatches = (name: string, eventKey: string): boolean => {
	if (name.length === 1) return eventKey.toLowerCase() === name
	const mapped = NAMED_KEYS[name]
	if (mapped) return eventKey === mapped
	return eventKey.toLowerCase() === name
}

const physicalMatches = (name: string, eventCode: string): boolean => {
	const mapped = PHYSICAL_CODES[name]
	if (mapped) return eventCode === mapped
	return eventCode.toLowerCase() === name
}

// Exact-set modifier matching, with one deliberate leniency: a single-char
// symbol binding (`+`, `:` …) accepts an event that needed shift to produce
// that symbol on the user's layout — Ghostty resolves this via layout
// introspection the webview doesn't have, and the produced character equality
// is the faithful approximation.
const shiftMatches = (chord: KeyChord, input: KeyInput): boolean => {
	if (chord.shift === input.shift) return true
	if (chord.shift || !input.shift) return false
	return (
		chord.key.kind === 'logical' &&
		chord.key.name.length === 1 &&
		!/[a-z]/.test(chord.key.name)
	)
}

const chordMatches = (chord: KeyChord, input: KeyInput): boolean => {
	if (
		chord.ctrl !== input.ctrl ||
		chord.alt !== input.alt ||
		chord.super !== input.super
	) {
		return false
	}
	const keyMatches =
		chord.key.kind === 'physical'
			? physicalMatches(chord.key.name, input.code)
			: logicalMatches(chord.key.name, input.key) ||
				altObscuresKey(chord, input)
	return keyMatches && shiftMatches(chord, input)
}

// macOS Option turns many keydowns into dead keys (option+n → key "Dead") or
// composed characters (option+f → "ƒ"), hiding the logical key an alt binding
// names. Ghostty matches such bindings against the UNMODIFIED key via layout
// introspection; the closest webview equivalent is the physical position, so
// an alt chord whose logical name is also a known physical key accepts the
// position match.
const altObscuresKey = (chord: KeyChord, input: KeyInput): boolean =>
	chord.alt &&
	chord.key.kind === 'logical' &&
	chord.key.name in PHYSICAL_CODES &&
	physicalMatches(chord.key.name, input.code)

// Build a matcher over the folded table. Bindings whose action is out of the
// parity scope are dropped here so their keys fall through (`pass`) instead of
// being consumed with no effect. Sequence state lives inside: feeding a chord
// that only prefixes longer triggers returns `pending` until a binding
// completes or a mismatch aborts.
export const createKeybindMatcher = (table: Keybind[]): KeybindMatcher => {
	const usable = table.filter(
		keybind =>
			keybind.action.kind !== 'unsupported' && keybind.trigger.length > 0,
	)

	let depth = 0
	let candidates = usable

	const reset = (): void => {
		depth = 0
		candidates = usable
	}

	return {
		feed: (input: KeyInput): MatchResult => {
			const inSequence = depth > 0
			const advancing = candidates.filter(keybind => {
				const next = keybind.trigger[depth]
				return next !== undefined && chordMatches(next, input)
			})

			if (advancing.length === 0) {
				reset()
				return inSequence ? { kind: 'abort' } : { kind: 'pass' }
			}

			// An exact-length binding wins over longer sequences sharing the
			// prefix: it fires now instead of waiting for keys that may never come.
			const complete = advancing.find(
				keybind => keybind.trigger.length === depth + 1,
			)
			if (complete) {
				reset()
				return {
					kind: 'action',
					action: complete.action,
					performable: complete.flags.performable,
				}
			}

			depth += 1
			candidates = advancing
			return { kind: 'pending' }
		},
	}
}
