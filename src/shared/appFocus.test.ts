import { beforeEach, describe, expect, it, vi } from 'vitest'

const { onFocusChangedMock } = vi.hoisted(() => ({
	onFocusChangedMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ onFocusChanged: onFocusChangedMock }),
}))

vi.mock('@/shared/logger', () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { onAppFocus, resetAppFocusForTests } from './appFocus'

type FocusHandler = (event: { payload: boolean }) => void

describe('onAppFocus', () => {
	let emitFocus: FocusHandler | null

	beforeEach(() => {
		resetAppFocusForTests()
		onFocusChangedMock.mockReset()
		emitFocus = null
		onFocusChangedMock.mockImplementation((handler: FocusHandler) => {
			emitFocus = handler
			return Promise.resolve(() => {})
		})
	})

	it('notifies subscribers when the window regains focus', () => {
		const onFocus = vi.fn()
		onAppFocus(onFocus)

		emitFocus?.({ payload: true })

		expect(onFocus).toHaveBeenCalledTimes(1)
	})

	it('ignores focus-lost events', () => {
		const onFocus = vi.fn()
		onAppFocus(onFocus)

		emitFocus?.({ payload: false })

		expect(onFocus).not.toHaveBeenCalled()
	})

	it('registers a single Tauri listener for many subscribers', () => {
		onAppFocus(vi.fn())
		onAppFocus(vi.fn())

		expect(onFocusChangedMock).toHaveBeenCalledTimes(1)
	})

	it('stops notifying a subscriber after it unsubscribes', () => {
		const onFocus = vi.fn()
		const off = onAppFocus(onFocus)

		off()
		emitFocus?.({ payload: true })

		expect(onFocus).not.toHaveBeenCalled()
	})

	it('fans one focus event out to every current subscriber', () => {
		const first = vi.fn()
		const second = vi.fn()
		const third = vi.fn()
		onAppFocus(first)
		onAppFocus(second)
		onAppFocus(third)

		emitFocus?.({ payload: true })

		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
		expect(third).toHaveBeenCalledTimes(1)
	})

	it('self-heals the bridge after a rejected registration', async () => {
		// First registration rejects (listener never attaches); a later
		// subscribe must retry and produce a working bridge.
		onFocusChangedMock.mockReset()
		onFocusChangedMock.mockImplementationOnce(() =>
			Promise.reject(new Error('window gone')),
		)

		const stranded = vi.fn()
		onAppFocus(stranded)
		// Let the rejected promise settle so the bridge drops back to idle.
		await Promise.resolve()
		await Promise.resolve()

		onFocusChangedMock.mockImplementation((handler: FocusHandler) => {
			emitFocus = handler
			return Promise.resolve(() => {})
		})

		const recovered = vi.fn()
		onAppFocus(recovered)
		// The retry registered a second listener only because the first never
		// attached — two onFocusChanged calls, but only one live listener.
		expect(onFocusChangedMock).toHaveBeenCalledTimes(2)

		emitFocus?.({ payload: true })

		// Both subscribers ride the one healed bridge.
		expect(recovered).toHaveBeenCalledTimes(1)
		expect(stranded).toHaveBeenCalledTimes(1)
	})

	it('does not register a second listener while one is in flight', () => {
		// A pending (not-yet-resolved) registration must gate concurrent
		// subscribes so they never spin up a duplicate listener.
		onFocusChangedMock.mockReset()
		onFocusChangedMock.mockImplementation((handler: FocusHandler) => {
			emitFocus = handler
			return new Promise<() => void>(() => {})
		})

		onAppFocus(vi.fn())
		onAppFocus(vi.fn())

		expect(onFocusChangedMock).toHaveBeenCalledTimes(1)
	})
})
