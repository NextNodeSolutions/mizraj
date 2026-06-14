import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_TOASTS, pushToast, toastsAtom, TOAST_TTL_MS } from './toasts'

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

	it('dedups a message already on screen instead of stacking it', () => {
		pushToast('same')
		pushToast('same')

		expect(store.get(toastsAtom).map(toast => toast.message)).toEqual([
			'same',
		])

		vi.advanceTimersByTime(TOAST_TTL_MS)
		expect(store.get(toastsAtom)).toEqual([])
	})

	it('caps the queue, dropping the oldest past MAX_TOASTS', () => {
		const messages = Array.from(
			{ length: MAX_TOASTS + 1 },
			(_unused, index) => `toast-${index}`,
		)
		for (const message of messages) pushToast(message)

		// The very first toast was dropped to keep the column bounded; the
		// MAX_TOASTS newest remain, oldest-first.
		expect(store.get(toastsAtom).map(toast => toast.message)).toEqual(
			messages.slice(1),
		)
	})
})
