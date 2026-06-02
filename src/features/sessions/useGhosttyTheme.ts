import { useEffect } from 'react'

import { useAppearance } from '@/features/settings/settings'

import { loadGhosttyConfig } from './ghosttyConfig'
import { ghosttyThemeTokens, THEME_TOKEN_KEYS } from './ghosttyTheme'

// Synchronizes <html>'s inline theme variables with the resolved Ghostty theme.
// This is a legitimate external-system sync (the document is outside React's
// tree): the effect fetches the config for the current appearance, clears any
// previously written theme tokens, then writes the fresh set when a theme is
// present. The async fetch is guarded so a late resolution never paints a
// torn-down (appearance-changed) scope. Mount once near the top of App.
export const useGhosttyTheme = (): void => {
	const appearance = useAppearance()

	useEffect(() => {
		let cancelled = false
		const { style } = document.documentElement

		const clearThemeTokens = (): void => {
			for (const name of THEME_TOKEN_KEYS) style.removeProperty(name)
		}

		void loadGhosttyConfig(appearance).then(config => {
			if (cancelled) return
			clearThemeTokens()
			const tokens = ghosttyThemeTokens(config)
			if (!tokens) return
			for (const [name, value] of Object.entries(tokens)) {
				style.setProperty(name, value)
			}
		})

		return () => {
			cancelled = true
			clearThemeTokens()
		}
	}, [appearance])
}
