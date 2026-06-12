import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKeydownRoute } from './terminalInput'
import type { RoutedKeydown } from './terminalInput'

const deps = {
	activeSessionId: vi.fn<() => string | null>(),
	feed: vi.fn(),
	execute: vi.fn(),
	propagate: vi.fn(),
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
		deps.propagate.mockReset()
	})

	it('executes a matched binding and sends nothing to the PTY', () => {
		deps.feed.mockReturnValue({
			kind: 'action',
			action: { kind: 'copy_to_clipboard' },
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
})
