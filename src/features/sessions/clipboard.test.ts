import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readTextMock, writeTextMock } = vi.hoisted(() => ({
	readTextMock: vi.fn(),
	writeTextMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
	readText: readTextMock,
	writeText: writeTextMock,
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

import { readClipboardText, writeClipboardText } from './clipboard'

describe('clipboard wrapper', () => {
	beforeEach(() => {
		readTextMock.mockReset()
		writeTextMock.mockReset()
		vi.mocked(logger.warn).mockReset()
	})

	it('writes text to the OS clipboard', async () => {
		writeTextMock.mockResolvedValue(undefined)

		await writeClipboardText('hello')

		expect(writeTextMock).toHaveBeenCalledWith('hello')
	})

	it('reads text from the OS clipboard', async () => {
		readTextMock.mockResolvedValue('pasted')

		await expect(readClipboardText()).resolves.toBe('pasted')
	})

	it('write failures are logged, not thrown', async () => {
		writeTextMock.mockRejectedValue(new Error('denied'))

		await expect(writeClipboardText('x')).resolves.toBeUndefined()
		expect(logger.warn).toHaveBeenCalledTimes(1)
	})

	it('read failures resolve to null and are logged', async () => {
		readTextMock.mockRejectedValue(new Error('denied'))

		await expect(readClipboardText()).resolves.toBeNull()
		expect(logger.warn).toHaveBeenCalledTimes(1)
	})
})
