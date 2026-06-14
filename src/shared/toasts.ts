import { atom, getDefaultStore } from 'jotai'

export type Toast = {
	id: number
	message: string
}

export const TOAST_TTL_MS = 2200

/** The most toasts shown at once; a burst drops the oldest past this. */
export const MAX_TOASTS = 4

export const toastsAtom = atom<ReadonlyArray<Toast>>([])

let nextToastId = 0

/**
 * Surface a transient confirmation ("Agent lancé", "Session arrêtée") at the
 * app's toast viewport. Callable from anywhere — atoms, launch flows, event
 * handlers — it writes the default store directly, and the toast removes
 * itself after {@link TOAST_TTL_MS}.
 *
 * A message already on screen is not stacked again (dedup within its TTL), and
 * the queue is capped at {@link MAX_TOASTS} so a burst can't grow an unbounded
 * column.
 */
export const pushToast = (message: string): void => {
	const store = getDefaultStore()
	const live = store.get(toastsAtom)
	if (live.some(toast => toast.message === message)) return
	nextToastId += 1
	const id = nextToastId
	// Keep the newest MAX_TOASTS - 1, then append this one. A dropped toast's
	// pending timer harmlessly filters an id that is already gone.
	const trimmed = live.slice(Math.max(0, live.length - (MAX_TOASTS - 1)))
	store.set(toastsAtom, [...trimmed, { id, message }])
	setTimeout(() => {
		store.set(
			toastsAtom,
			store.get(toastsAtom).filter(toast => toast.id !== id),
		)
	}, TOAST_TTL_MS)
}
