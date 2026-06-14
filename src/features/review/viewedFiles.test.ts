import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it } from 'vitest'

import {
	reviewProgress,
	toggleViewedAtom,
	viewedFilesAtom,
} from './viewedFiles'

const store = getDefaultStore()

describe('viewed files', () => {
	beforeEach(() => {
		store.set(viewedFilesAtom, {})
	})

	it('toggleViewedAtom marks a path viewed then unviewed', () => {
		store.set(toggleViewedAtom, 'src/a.ts')
		expect(store.get(viewedFilesAtom)['src/a.ts']).toBe(true)

		store.set(toggleViewedAtom, 'src/a.ts')
		expect(store.get(viewedFilesAtom)['src/a.ts']).toBeUndefined()
	})

	it('reviewProgress counts only paths present in the current diff', () => {
		store.set(toggleViewedAtom, 'src/a.ts')
		store.set(toggleViewedAtom, 'src/stale.ts')

		const progress = reviewProgress(store.get(viewedFilesAtom), [
			'src/a.ts',
			'src/b.ts',
		])

		expect(progress).toEqual({ viewed: 1, total: 2, percent: 50 })
	})

	it('reviewProgress handles an empty diff', () => {
		expect(reviewProgress({}, [])).toEqual({
			viewed: 0,
			total: 0,
			percent: 0,
		})
	})
})
