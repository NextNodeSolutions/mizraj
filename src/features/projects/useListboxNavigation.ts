import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type ListboxNavigation = {
	/** Index of the highlighted row, clamped in bounds as the list changes. */
	highlighted: number
	setHighlighted: React.Dispatch<React.SetStateAction<number>>
}

type Options<E> = {
	entries: ReadonlyArray<E>
	/** The window listener only runs while the popup is open. */
	isOpen: boolean
	/** Escape closes the popup. */
	onClose: () => void
	/** Enter activates the highlighted row. */
	onChoose: (entry: E | undefined) => void
	/**
	 * Delete/Backspace on the highlighted row. Return true if it acted (the key
	 * is then consumed); return false to let the key fall through (e.g. a
	 * non-removable row).
	 */
	onRemove?: (entry: E) => boolean
}

/**
 * Keyboard navigation for a popup listbox owned at the window capture phase
 * (like the command palette), so an embedded terminal never sees a handled
 * chord. Owns the highlight index and its in-bounds clamp; the caller owns the
 * open/close state, the entries and the per-row callbacks.
 */
export const useListboxNavigation = <E>({
	entries,
	isOpen,
	onClose,
	onChoose,
	onRemove,
}: Options<E>): ListboxNavigation => {
	const [highlighted, setHighlighted] = useState(0)

	// Clamp the highlight in bounds before paint when the list shrinks (a pruned
	// or vanished row), so it can never point past the last entry.
	useLayoutEffect(() => {
		setHighlighted(current => Math.min(current, entries.length - 1))
	}, [entries.length])

	// Read live state through a ref so the window listener subscribes once per
	// open, not on every hover-driven render.
	const stateRef = useRef({
		entries,
		highlighted,
		onClose,
		onChoose,
		onRemove,
	})
	stateRef.current = { entries, highlighted, onClose, onChoose, onRemove }

	useEffect(() => {
		if (!isOpen) return
		const onKeydown = (event: KeyboardEvent): void => {
			const state = stateRef.current
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				state.onClose()
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				event.stopPropagation()
				const step = event.key === 'ArrowDown' ? 1 : -1
				setHighlighted(current =>
					Math.max(
						0,
						Math.min(current + step, state.entries.length - 1),
					),
				)
				return
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				const entry = state.entries[state.highlighted]
				if (entry === undefined || state.onRemove === undefined) return
				if (!state.onRemove(entry)) return
				event.preventDefault()
				event.stopPropagation()
				return
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				state.onChoose(state.entries[state.highlighted])
			}
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, { capture: true })
	}, [isOpen])

	return { highlighted, setHighlighted }
}
