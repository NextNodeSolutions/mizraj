import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'

import { approvedSessionIdsAtom, approveSessionAtom } from './approvedSessions'

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

		expect([...store.get(approvedSessionIdsAtom)].sort()).toEqual([
			'sess-1',
			'sess-2',
		])
	})
})
