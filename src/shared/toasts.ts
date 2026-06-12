import { atom, getDefaultStore } from 'jotai'

export type Toast = {
	id: number
	message: string
}

export const TOAST_TTL_MS = 2200

export const toastsAtom = atom<ReadonlyArray<Toast>>([])

let nextToastId = 0

/**
 * Surface a transient confirmation ("Agent lancé", "Session arrêtée") at the
 * app's toast viewport. Callable from anywhere — atoms, launch flows, event
 * handlers — it writes the default store directly, and the toast removes
 * itself after {@link TOAST_TTL_MS}.
 */
export const pushToast = (message: string): void => {
	const store = getDefaultStore()
	nextToastId += 1
	const id = nextToastId
	store.set(toastsAtom, [...store.get(toastsAtom), { id, message }])
	setTimeout(() => {
		store.set(
			toastsAtom,
			store.get(toastsAtom).filter(toast => toast.id !== id),
		)
	}, TOAST_TTL_MS)
}
