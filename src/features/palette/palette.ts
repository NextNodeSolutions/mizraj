import { atom, getDefaultStore } from 'jotai'

export const paletteOpenAtom = atom(false)

/** Open the command palette from anywhere — the top bar's Jump button. */
export const openPalette = (): void => {
	getDefaultStore().set(paletteOpenAtom, true)
}
