import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listenMock, unlistenMock } = vi.hoisted(() => ({
	listenMock: vi.fn(),
	unlistenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock,
}))

import {
	GHOSTTY_CONFIG_CHANGED_EVENT,
	ghosttyConfigEpochAtom,
	resetGhosttyConfigBridgeForTests,
	startGhosttyConfigBridge,
} from './ghosttyConfigBridge'

const store = getDefaultStore()

describe('startGhosttyConfigBridge', () => {
	beforeEach(() => {
		resetGhosttyConfigBridgeForTests()
		store.set(ghosttyConfigEpochAtom, 0)
		listenMock.mockReset()
		unlistenMock.mockReset()
		listenMock.mockResolvedValue(unlistenMock)
	})

	it('listens to ghostty:config-changed exactly once', () => {
		startGhosttyConfigBridge()
		startGhosttyConfigBridge()
		startGhosttyConfigBridge()

		expect(listenMock).toHaveBeenCalledTimes(1)
		expect(listenMock).toHaveBeenCalledWith(
			GHOSTTY_CONFIG_CHANGED_EVENT,
			expect.any(Function),
		)
	})

	it('bumps the epoch on every config change', () => {
		startGhosttyConfigBridge()
		const call = listenMock.mock.calls[0]
		if (!call) throw new Error('listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('listen() handler was not a function')
		}

		handler()
		handler()

		expect(store.get(ghosttyConfigEpochAtom)).toBe(2)
	})

	it('allows a retry after a failed listen', async () => {
		listenMock.mockRejectedValueOnce(new Error('webview not ready'))

		startGhosttyConfigBridge()
		await Promise.resolve()
		await Promise.resolve()
		startGhosttyConfigBridge()

		expect(listenMock).toHaveBeenCalledTimes(2)
	})
})
