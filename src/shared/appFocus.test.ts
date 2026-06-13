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
})
