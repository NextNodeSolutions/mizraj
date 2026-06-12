import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKeydownRoute } from './terminalInput'
import type { RoutedKeydown } from './terminalInput'

const deps = {
	activeSessionId: vi.fn<() => string | null>(),
	feed: vi.fn(),
	execute: vi.fn(),
	canPerform: vi.fn<() => boolean>(),
	propagate: vi.fn(),
	altIsMeta: vi.fn<() => boolean>(),
	composerActive: vi.fn<() => boolean>(),
}

const keydown = (overrides: Partial<RoutedKeydown>): RoutedKeydown => ({
	key: 'c',
	code: 'KeyC',
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	metaKey: false,
	target: null,
	preventDefault: vi.fn(),
	...overrides,
})

describe('createKeydownRoute', () => {
	beforeEach(() => {
		deps.activeSessionId.mockReset().mockReturnValue('sess-1')
		deps.feed.mockReset().mockReturnValue({ kind: 'pass' })
		deps.execute.mockReset()
		deps.canPerform.mockReset().mockReturnValue(true)
		deps.propagate.mockReset()
		deps.altIsMeta.mockReset().mockReturnValue(false)
		deps.composerActive.mockReset().mockReturnValue(false)
	})

	it('executes a matched binding and sends nothing to the PTY', () => {
		deps.feed.mockReturnValue({
			kind: 'action',
			action: { kind: 'copy_to_clipboard' },
			performable: false,
		})
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 'c', metaKey: true })

		route(event)

		expect(deps.execute).toHaveBeenCalledWith(
			{ kind: 'copy_to_clipboard' },
			{ sessionId: 'sess-1' },
		)
		expect(deps.propagate).not.toHaveBeenCalled()
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it('lets a non-actionable performable binding fall through to the PTY', () => {
		deps.feed.mockReturnValue({
			kind: 'action',
			action: { kind: 'goto_split', focus: 'left' },
			performable: true,
		})
		deps.canPerform.mockReturnValue(false)
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 'h', code: 'KeyH', altKey: true })

		route(event)

		expect(deps.execute).not.toHaveBeenCalled()
		expect(deps.propagate).toHaveBeenCalled()
	})

	it('propagates an unbound key to the PTY as before', () => {
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 'x', code: 'KeyX' })

		route(event)

		expect(deps.propagate).toHaveBeenCalledWith('sess-1', {
			code: 'KeyX',
			text: 'x',
			ctrl: false,
			alt: false,
			shift: false,
		})
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it('leaves an unbound cmd key to the app/OS', () => {
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 't', metaKey: true })

		route(event)

		expect(deps.propagate).not.toHaveBeenCalled()
		expect(deps.execute).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})

	it('consumes pending and aborted sequence keys silently', () => {
		const route = createKeydownRoute(deps)

		deps.feed.mockReturnValue({ kind: 'pending' })
		const leader = keydown({ key: 'a', ctrlKey: true })
		route(leader)
		expect(leader.preventDefault).toHaveBeenCalled()

		deps.feed.mockReturnValue({ kind: 'abort' })
		const interrupter = keydown({ key: 'x' })
		route(interrupter)
		expect(interrupter.preventDefault).toHaveBeenCalled()

		expect(deps.propagate).not.toHaveBeenCalled()
		expect(deps.execute).not.toHaveBeenCalled()
	})

	it('ignores lone modifiers, interactive targets and sessionless keys', () => {
		const route = createKeydownRoute(deps)

		route(keydown({ key: 'Shift' }))

		const field = document.createElement('input')
		route(keydown({ target: field }))

		deps.activeSessionId.mockReturnValue(null)
		route(keydown({ key: 'x' }))

		expect(deps.feed).not.toHaveBeenCalled()
		expect(deps.propagate).not.toHaveBeenCalled()
	})

	it('leaves a dead key to the composer (no bytes, no preventDefault)', () => {
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 'Dead', code: 'Quote' })

		route(event)

		expect(deps.propagate).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})

	it('skips mid-composition keydowns entirely', () => {
		const route = createKeydownRoute(deps)
		const event = keydown({ key: ' ', code: 'Space', isComposing: true })

		route(event)

		expect(deps.feed).not.toHaveBeenCalled()
		expect(deps.propagate).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})

	it('hands printable keys to the focused composer untouched', () => {
		deps.composerActive.mockReturnValue(true)
		const route = createKeydownRoute(deps)
		const event = keydown({ key: 'x', code: 'KeyX' })

		route(event)

		expect(deps.propagate).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})

	it('sends option-composed characters as plain text when option is not alt', () => {
		// macos-option-as-alt unset: option+5 on AZERTY composes "{".
		const route = createKeydownRoute(deps)
		const event = keydown({ key: '{', code: 'Digit5', altKey: true })

		route(event)

		expect(deps.propagate).toHaveBeenCalledWith('sess-1', {
			code: 'Digit5',
			text: '{',
			ctrl: false,
			alt: false,
			shift: false,
		})
	})

	it('encodes option as alt with the logical key when configured', () => {
		deps.altIsMeta.mockReturnValue(true)
		const route = createKeydownRoute(deps)
		// The composed text (ƒ) must NOT ride along: the encoder derives ESC f
		// from the physical code, like Ghostty with macos-option-as-alt.
		const event = keydown({ key: 'ƒ', code: 'KeyF', altKey: true })

		route(event)

		expect(deps.propagate).toHaveBeenCalledWith('sess-1', {
			code: 'KeyF',
			text: null,
			ctrl: false,
			alt: true,
			shift: false,
		})
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it('still routes ctrl chords and non-printable keys around the composer', () => {
		deps.composerActive.mockReturnValue(true)
		const route = createKeydownRoute(deps)

		const ctrl = keydown({ key: 'c', ctrlKey: true })
		route(ctrl)
		expect(deps.propagate).toHaveBeenLastCalledWith('sess-1', {
			code: 'KeyC',
			text: 'c',
			ctrl: true,
			alt: false,
			shift: false,
		})
		expect(ctrl.preventDefault).toHaveBeenCalled()

		const enter = keydown({ key: 'Enter', code: 'Enter' })
		route(enter)
		expect(deps.propagate).toHaveBeenLastCalledWith('sess-1', {
			code: 'Enter',
			text: null,
			ctrl: false,
			alt: false,
			shift: false,
		})
		expect(enter.preventDefault).toHaveBeenCalled()
	})
})
