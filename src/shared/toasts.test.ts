import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pushToast, toastsAtom, TOAST_TTL_MS } from './toasts'

const store = getDefaultStore()

describe('toasts store', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		store.set(toastsAtom, [])
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('pushToast surfaces the message immediately', () => {
		pushToast('Agent lancé')

		expect(store.get(toastsAtom).map(toast => toast.message)).toEqual([
			'Agent lancé',
		])
	})

	it('a toast disappears after its time to live', () => {
		pushToast('Session arrêtée')

		vi.advanceTimersByTime(TOAST_TTL_MS)

		expect(store.get(toastsAtom)).toEqual([])
	})

	it('stacked toasts expire independently, oldest first', () => {
		pushToast('first')
		vi.advanceTimersByTime(TOAST_TTL_MS / 2)
		pushToast('second')

		vi.advanceTimersByTime(TOAST_TTL_MS / 2)

		expect(store.get(toastsAtom).map(toast => toast.message)).toEqual([
			'second',
		])
	})

	it('two toasts with the same message expire without clobbering each other', () => {
		pushToast('same')
		pushToast('same')

		vi.advanceTimersByTime(TOAST_TTL_MS)

		expect(store.get(toastsAtom)).toEqual([])
	})
})
