import { useEffect } from 'react'

import { useCockpitTargetHref } from '@/features/sessions/cockpitTarget'

import { navigate } from './router'
import { shellViews } from './shellViews'

// ⌘/Ctrl + a 1-based digit, mapped to a shell view by position. Returns the
// 0-based index, or null when the event isn't such a chord.
const chordIndex = (event: KeyboardEvent): number | null => {
	if (!(event.metaKey || event.ctrlKey)) return null
	const digit = Number(event.key)
	if (!Number.isInteger(digit) || digit < 1) return null
	return digit - 1
}

// Don't hijack ⌘/Ctrl+digit while the caret sits in editable text — the digit
// is a character the user is typing, and stealing it would swallow keystrokes.
const isEditableTarget = (): boolean => {
	const active = document.activeElement
	if (active === null) return false
	if (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement
	) {
		return true
	}
	return active instanceof HTMLElement && active.isContentEditable
}

/**
 * ⌘/Ctrl+1..N jump between the shell views, in the same order as the rail
 * (both derive from shellViews, so the chord upper bound and the targets can
 * never drift). Registered at the window's CAPTURE phase with the chord fully
 * claimed (preventDefault + stopPropagation) so the terminal's own key router —
 * and any Ghostty binding — never sees a handled chord, same rationale as the
 * palette's ⌘K.
 */
export const useShellShortcuts = (): void => {
	const cockpitHref = useCockpitTargetHref()

	useEffect(() => {
		const views = shellViews(cockpitHref)
		const onKeydown = (event: KeyboardEvent): void => {
			const index = chordIndex(event)
			if (index === null || index >= views.length) return
			if (isEditableTarget()) return
			const view = views[index]
			if (view === undefined) return
			event.preventDefault()
			event.stopPropagation()
			navigate(view.href)
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, {
				capture: true,
			})
	}, [cockpitHref])
}
