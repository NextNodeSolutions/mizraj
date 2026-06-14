import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'

import {
	approvedSessionIdsAtom,
	approveSessionAtom,
	pruneApprovedSessionsAtom,
} from './approvedSessions'

describe('approvedSessions', () => {
	it('starts with no approved session', () => {
		const store = createStore()

		expect(store.get(approvedSessionIdsAtom).size).toBe(0)
	})

	it('records an approved session id', () => {
		const store = createStore()

		store.set(approveSessionAtom, 'sess-1')

		expect(store.get(approvedSessionIdsAtom).has('sess-1')).toBe(true)
	})

	it('keeps previously approved sessions when another is approved', () => {
		const store = createStore()

		store.set(approveSessionAtom, 'sess-1')
		store.set(approveSessionAtom, 'sess-2')

		expect([...store.get(approvedSessionIdsAtom)].toSorted()).toEqual([
			'sess-1',
			'sess-2',
		])
	})

	it('prunes approved ids whose session has vanished from the live set', () => {
		const store = createStore()
		store.set(approveSessionAtom, 'sess-1')
		store.set(approveSessionAtom, 'sess-2')

		store.set(pruneApprovedSessionsAtom, new Set(['sess-2']))

		expect([...store.get(approvedSessionIdsAtom)]).toEqual(['sess-2'])
	})

	it('leaves the set reference untouched when nothing is stale', () => {
		const store = createStore()
		store.set(approveSessionAtom, 'sess-1')
		const before = store.get(approvedSessionIdsAtom)

		store.set(pruneApprovedSessionsAtom, new Set(['sess-1', 'sess-2']))

		// A no-op prune must not replace the set, so the effect that drives it
		// does not loop on its own write.
		expect(store.get(approvedSessionIdsAtom)).toBe(before)
	})
})
