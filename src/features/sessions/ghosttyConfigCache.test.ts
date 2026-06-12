import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

import { EMPTY_CONFIG } from './ghosttyConfig'
import { ghosttyConfigEpochAtom } from './ghosttyConfigBridge'
import {
	getRenderBundle,
	resetRenderBundleCacheForTests,
} from './ghosttyConfigCache'

const store = getDefaultStore()

// measureCell only sets `font` and measures one glyph; this stub is enough.
const fakeContext = (): CanvasRenderingContext2D => {
	const context: Pick<CanvasRenderingContext2D, 'font'> & {
		measureText: (text: string) => { width: number }
	} = {
		font: '',
		measureText: () => ({ width: 7 }),
	}
	if (!isRenderingContext(context)) {
		throw new Error('fake context must satisfy the measureCell surface')
	}
	return context
}

const isRenderingContext = (
	value: unknown,
): value is CanvasRenderingContext2D =>
	typeof value === 'object' &&
	value !== null &&
	'measureText' in value &&
	'font' in value

describe('getRenderBundle', () => {
	beforeEach(() => {
		store.set(ghosttyConfigEpochAtom, 0)
		invokeMock.mockReset()
		invokeMock.mockResolvedValue(EMPTY_CONFIG)
		resetRenderBundleCacheForTests()
	})

	it('loads and derives once, then serves the same bundle from cache', async () => {
		const first = await getRenderBundle('dark', fakeContext())
		const second = await getRenderBundle('dark', fakeContext())

		expect(invokeMock).toHaveBeenCalledTimes(1)
		expect(second).toBe(first)
		expect(first.metrics.cellWidth).toBe(7)
		expect(first.fontTable.length).toBeGreaterThan(0)
		expect(first.palette.length).toBe(256)
	})

	it('keys the cache by appearance', async () => {
		await getRenderBundle('dark', fakeContext())
		await getRenderBundle('light', fakeContext())

		expect(invokeMock).toHaveBeenCalledTimes(2)
	})

	it('rebuilds after a config epoch bump (hot reload)', async () => {
		const stale = await getRenderBundle('dark', fakeContext())

		store.set(ghosttyConfigEpochAtom, 1)
		const fresh = await getRenderBundle('dark', fakeContext())

		expect(invokeMock).toHaveBeenCalledTimes(2)
		expect(fresh).not.toBe(stale)
	})
})
