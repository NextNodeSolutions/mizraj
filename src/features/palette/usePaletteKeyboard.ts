import { useEffect, useRef } from 'react'

const isToggleChord = (event: KeyboardEvent): boolean =>
	(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'

type PaletteKeyboard = {
	open: boolean
	/** Summon the palette (⌘K while closed). */
	openPalette: () => void
	/** Dismiss the palette (⌘K while open, or Escape). */
	close: () => void
	/** Tab is trapped: focus returns to the search input. */
	focusInput: () => void
	/** Arrow keys move the highlight by ±1. */
	moveSelection: (step: number) => void
	/** Enter runs the highlighted item. */
	runSelected: () => void
}

/**
 * The palette's keyboard routing, owned at the window's capture phase so the
 * terminal's own key router (and any Ghostty ⌘K binding) never sees a handled
 * chord. The listener binds once; it delegates to the latest deps through a ref
 * so it isn't re-bound on every render. The caller owns state and rendering.
 */
export const usePaletteKeyboard = (deps: PaletteKeyboard): void => {
	const depsRef = useRef(deps)
	depsRef.current = deps

	useEffect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			const current = depsRef.current
			if (isToggleChord(event)) {
				event.preventDefault()
				event.stopPropagation()
				if (current.open) current.close()
				else current.openPalette()
				return
			}
			if (!current.open) return
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				current.close()
				return
			}
			// Trap Tab inside the dialog: the input is its only tabbable element,
			// so keeping focus there is the whole trap.
			if (event.key === 'Tab') {
				event.preventDefault()
				event.stopPropagation()
				current.focusInput()
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				event.stopPropagation()
				current.moveSelection(event.key === 'ArrowDown' ? 1 : -1)
				return
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				current.runSelected()
			}
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, { capture: true })
	}, [])
}
