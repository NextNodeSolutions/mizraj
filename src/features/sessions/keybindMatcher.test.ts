import { describe, expect, it } from 'vitest'

import type { Keybind, KeybindAction, KeyChord } from './ghosttyConfig'
import type { KeyInput } from './keybindMatcher'
import { createKeybindMatcher } from './keybindMatcher'

const chord = (overrides: Partial<KeyChord> & Pick<KeyChord, 'key'>): KeyChord => ({
	shift: false,
	ctrl: false,
	alt: false,
	super: false,
	...overrides,
})

const bind = (
	trigger: KeyChord[],
	action: KeybindAction = { kind: 'copy_to_clipboard' },
): Keybind => ({
	trigger,
	flags: { global: false, all: false, unconsumed: false, performable: false },
	action,
})

const input = (overrides: Partial<KeyInput>): KeyInput => ({
	key: 'a',
	code: 'KeyA',
	shift: false,
	ctrl: false,
	alt: false,
	super: false,
	...overrides,
})

describe('createKeybindMatcher', () => {
	it('matches a single chord and returns its action', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ ctrl: true, shift: true, key: { kind: 'logical', name: 'c' } })]),
		])

		const result = matcher.feed(
			input({ key: 'C', code: 'KeyC', ctrl: true, shift: true }),
		)

		expect(result).toEqual({
			kind: 'action',
			action: { kind: 'copy_to_clipboard' },
		})
	})

	it('requires the exact modifier set', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ ctrl: true, key: { kind: 'logical', name: 'c' } })]),
		])

		expect(
			matcher.feed(input({ key: 'c', code: 'KeyC', ctrl: true, shift: true })),
		).toEqual({ kind: 'pass' })
	})

	it('maps super onto the meta modifier', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ super: true, key: { kind: 'logical', name: 'v' } })], {
				kind: 'paste_from_clipboard',
			}),
		])

		expect(
			matcher.feed(input({ key: 'v', code: 'KeyV', super: true })),
		).toEqual({ kind: 'action', action: { kind: 'paste_from_clipboard' } })
	})

	it('matches named keys against KeyboardEvent.key vocabulary', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ key: { kind: 'logical', name: 'page_up' } })], {
				kind: 'clear_screen',
			}),
		])

		expect(matcher.feed(input({ key: 'PageUp', code: 'PageUp' }))).toEqual({
			kind: 'action',
			action: { kind: 'clear_screen' },
		})
	})

	it('matches physical keys against KeyboardEvent.code', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ ctrl: true, key: { kind: 'physical', name: 'a' } })], {
				kind: 'select_all',
			}),
		])

		// AZERTY-style: logical key differs, physical position is KeyA.
		expect(
			matcher.feed(input({ key: 'q', code: 'KeyA', ctrl: true })),
		).toEqual({ kind: 'action', action: { kind: 'select_all' } })
	})

	it('is lenient about shift for shifted symbols', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ super: true, key: { kind: 'logical', name: '+' } })], {
				kind: 'increase_font_size',
				amount: 1,
			}),
		])

		// '+' often requires shift to type; the binding says nothing about
		// shift, the event carries it — still a match.
		expect(
			matcher.feed(input({ key: '+', code: 'Equal', super: true, shift: true })),
		).toEqual({
			kind: 'action',
			action: { kind: 'increase_font_size', amount: 1 },
		})
	})

	it('walks a leader sequence: pending, then the action', () => {
		const matcher = createKeybindMatcher([
			bind(
				[
					chord({ ctrl: true, key: { kind: 'logical', name: 'a' } }),
					chord({ key: { kind: 'logical', name: 'n' } }),
				],
				{ kind: 'text', text: 'next' },
			),
		])

		expect(matcher.feed(input({ key: 'a', code: 'KeyA', ctrl: true }))).toEqual(
			{ kind: 'pending' },
		)
		expect(matcher.feed(input({ key: 'n', code: 'KeyN' }))).toEqual({
			kind: 'action',
			action: { kind: 'text', text: 'next' },
		})
	})

	it('an interrupted sequence swallows the interrupting key and resets', () => {
		const matcher = createKeybindMatcher([
			bind(
				[
					chord({ ctrl: true, key: { kind: 'logical', name: 'a' } }),
					chord({ key: { kind: 'logical', name: 'n' } }),
				],
				{ kind: 'text', text: 'next' },
			),
		])

		expect(matcher.feed(input({ key: 'a', code: 'KeyA', ctrl: true }))).toEqual(
			{ kind: 'pending' },
		)
		// 'x' matches no continuation: swallowed, sequence aborted…
		expect(matcher.feed(input({ key: 'x', code: 'KeyX' }))).toEqual({
			kind: 'abort',
		})
		// …and the next 'n' is a plain key again.
		expect(matcher.feed(input({ key: 'n', code: 'KeyN' }))).toEqual({
			kind: 'pass',
		})
	})

	it('ignores bindings whose action is unsupported (key falls through)', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ super: true, key: { kind: 'logical', name: 'n' } })], {
				kind: 'unsupported',
				action: 'new_window',
			}),
		])

		expect(matcher.feed(input({ key: 'n', code: 'KeyN', super: true }))).toEqual(
			{ kind: 'pass' },
		)
	})

	it('consumes an ignore binding without any action', () => {
		const matcher = createKeybindMatcher([
			bind([chord({ ctrl: true, key: { kind: 'logical', name: 'l' } })], {
				kind: 'ignore',
			}),
		])

		expect(matcher.feed(input({ key: 'l', code: 'KeyL', ctrl: true }))).toEqual(
			{ kind: 'action', action: { kind: 'ignore' } },
		)
	})
})
