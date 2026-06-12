import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CellFramePayload } from './terminalWire'

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

import { fetchSessionFrame } from './fetchSessionFrame'

const frame: CellFramePayload = {
	session_id: 'sess-1',
	cols: 1,
	rows: 1,
	cells: [],
	cursor: null,
}

describe('fetchSessionFrame', () => {
	beforeEach(() => {
		invokeMock.mockReset()
		vi.mocked(logger.warn).mockReset()
	})

	it('returns the pulled frame', async () => {
		invokeMock.mockResolvedValue(frame)

		await expect(fetchSessionFrame('sess-1')).resolves.toBe(frame)
		expect(invokeMock).toHaveBeenCalledWith('session_get_frame', {
			sessionId: 'sess-1',
		})
	})

	it('returns null quietly when the session is gone or frameless', async () => {
		invokeMock.mockRejectedValueOnce({
			kind: 'not_found',
			session_id: 'sess-1',
		})
		await expect(fetchSessionFrame('sess-1')).resolves.toBeNull()

		invokeMock.mockRejectedValueOnce({
			kind: 'frame_unavailable',
			session_id: 'sess-1',
		})
		await expect(fetchSessionFrame('sess-1')).resolves.toBeNull()

		expect(logger.warn).not.toHaveBeenCalled()
	})

	it('returns null and logs on unexpected failures', async () => {
		invokeMock.mockRejectedValue(new Error('ipc broke'))

		await expect(fetchSessionFrame('sess-1')).resolves.toBeNull()
		expect(logger.warn).toHaveBeenCalledTimes(1)
	})
})
