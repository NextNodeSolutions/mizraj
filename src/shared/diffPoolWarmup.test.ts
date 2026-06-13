import { describe, expect, it, vi } from 'vitest'

import { buildWarmDiffs, warmDiffPool } from './diffPoolWarmup'

const POOL_SIZE = 2
const WARM_LANG_COUNT = 9

describe('buildWarmDiffs', () => {
	it('emits poolSize variants for every primary language', () => {
		const diffs = buildWarmDiffs(POOL_SIZE)
		expect(diffs).toHaveLength(WARM_LANG_COUNT * POOL_SIZE)
	})

	it('stamps a distinct cacheKey on each diff so priming is never deduped', () => {
		const keys = buildWarmDiffs(POOL_SIZE).map(diff => diff.cacheKey)
		expect(keys.every(key => key !== undefined)).toBe(true)
		expect(new Set(keys).size).toBe(keys.length)
	})

	it('lays variants of one language out adjacently for both-worker coverage', () => {
		const names = buildWarmDiffs(POOL_SIZE).map(diff => diff.name)
		expect(names.slice(0, POOL_SIZE)).toEqual([
			'__warm__.ts',
			'__warm__.ts',
		])
	})

	it('carries real added content, so the worker actually tokenizes', () => {
		const diffs = buildWarmDiffs(POOL_SIZE)
		expect(
			diffs.every(diff => (diff.additionLines?.length ?? 0) > 0),
		).toBe(true)
	})
})

describe('warmDiffPool', () => {
	it('primes the pool once per built diff', () => {
		const primeDiffHighlightCache = vi.fn()
		warmDiffPool({ primeDiffHighlightCache }, POOL_SIZE)
		expect(primeDiffHighlightCache).toHaveBeenCalledTimes(
			WARM_LANG_COUNT * POOL_SIZE,
		)
	})
})
