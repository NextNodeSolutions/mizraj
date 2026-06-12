import { useEffect } from 'react'

import { useCockpitTargetHref } from '@/features/sessions/cockpitTarget'

import {
	missionControlHref,
	navigate,
	pipelineHref,
	plansIndexHref,
	reviewHref,
} from './router'

const FIRST_CHORD_KEY = '1'
const LAST_CHORD_KEY = '5'

const chordIndex = (event: KeyboardEvent): number | null => {
	if (!(event.metaKey || event.ctrlKey)) return null
	if (event.key < FIRST_CHORD_KEY || event.key > LAST_CHORD_KEY) return null
	return Number(event.key) - Number(FIRST_CHORD_KEY)
}

/**
 * ⌘/Ctrl+1..5 jump between the five views (mission, cockpit, board, plans,
 * review). Registered at the window's CAPTURE phase with the chord fully
 * claimed (preventDefault + stopPropagation) so the terminal's own key
 * router — and any Ghostty binding — never sees a handled chord, same
 * rationale as the palette's ⌘K.
 */
export const useShellShortcuts = (): void => {
	const cockpitHref = useCockpitTargetHref()

	useEffect(() => {
		const targets = [
			missionControlHref(),
			cockpitHref,
			pipelineHref(),
			plansIndexHref(),
			reviewHref(),
		]
		const onKeydown = (event: KeyboardEvent): void => {
			const index = chordIndex(event)
			if (index === null) return
			const href = targets[index]
			if (href === undefined) return
			event.preventDefault()
			event.stopPropagation()
			navigate(href)
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, {
				capture: true,
			})
	}, [cockpitHref])
}
