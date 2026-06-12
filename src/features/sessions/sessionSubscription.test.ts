import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { logger } from '@/shared/logger'

import { subscribeToCellFrames } from './sessionSubscription'

const flushMicrotasks = async (): Promise<void> => {
	await Promise.resolve()
	await Promise.resolve()
}

describe('subscribeToCellFrames', () => {
	beforeEach(() => {
		invokeMock.mockReset()
		invokeMock.mockResolvedValue(undefined)
		vi.mocked(logger.warn).mockReset()
		vi.mocked(logger.debug).mockReset()
	})

	it('subscribes the session on call', () => {
		subscribeToCellFrames('sess-1')

		expect(invokeMock).toHaveBeenCalledWith('session_subscribe', {
			sessionId: 'sess-1',
		})
	})

	it('unsubscribes the session on release', () => {
		const release = subscribeToCellFrames('sess-1')
		release()

		expect(invokeMock).toHaveBeenCalledWith('session_unsubscribe', {
			sessionId: 'sess-1',
		})
	})

	it('stays quiet when the session is already gone (not_found)', async () => {
		invokeMock.mockRejectedValue({ kind: 'not_found', session_id: 'sess-1' })

		const release = subscribeToCellFrames('sess-1')
		release()
		await flushMicrotasks()

		expect(logger.warn).not.toHaveBeenCalled()
	})

	it('logs unexpected failures instead of throwing', async () => {
		invokeMock.mockRejectedValue(new Error('ipc broke'))

		subscribeToCellFrames('sess-1')
		await flushMicrotasks()

		expect(logger.warn).toHaveBeenCalledTimes(1)
	})
})
