import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { useAppearance } from '@/features/settings/settings'

import {
	familyStackFrom,
	loadGhosttyConfig,
	resolveOptionAsAlt,
} from './ghosttyConfig'
import { ghosttyConfigEpochAtom } from './ghosttyConfigBridge'
import { ghosttyThemeTokens, THEME_TOKEN_KEYS } from './ghosttyTheme'
import { keybindTableAtom, optionAsAltAtom } from './keybindRuntime'

// The app-wide mono stack follows the config's font-family even when the
// config carries no colors (ghosttyThemeTokens -> null): fonts and theme are
// independent axes of a Ghostty config. Deliberately NOT in THEME_TOKEN_KEYS
// (that list is asserted to be exactly what ghosttyThemeTokens emits); it
// shares the exact same apply/clear lifecycle through clearThemeTokens.
const FONT_MONO_TOKEN = '--font-mono'

const clearThemeTokens = (style: CSSStyleDeclaration): void => {
	for (const name of THEME_TOKEN_KEYS) style.removeProperty(name)
	style.removeProperty(FONT_MONO_TOKEN)
}

// Synchronizes <html>'s inline theme variables with the resolved Ghostty theme.
// This is a legitimate external-system sync (the document is outside React's
// tree): the effect fetches the config for the current appearance and swaps in
// the fresh token set ONLY once it resolves — re-runs (appearance flip, epoch
// bump = hot reload) never strip the live tokens up front, so there is no
// one-round-trip flash of stylesheet defaults. The async fetch is guarded so a
// late resolution never paints a torn-down (appearance-changed) scope; tokens
// are removed only on unmount. Mount once near the top of App.
export const useGhosttyTheme = (): void => {
	const appearance = useAppearance()
	const configEpoch = useAtomValue(ghosttyConfigEpochAtom)
	const seedKeybindTable = useSetAtom(keybindTableAtom)
	const seedOptionAsAlt = useSetAtom(optionAsAltAtom)

	useEffect(() => {
		let cancelled = false
		const { style } = document.documentElement

		void loadGhosttyConfig(appearance).then(config => {
			if (cancelled) return
			// The input router's matcher follows this table; seeding it here
			// keeps every app-level config consumer on one load path.
			seedKeybindTable(config.keybinds)
			seedOptionAsAlt(resolveOptionAsAlt(config))
			const tokens = ghosttyThemeTokens(config)
			// Replace, don't clear-then-fetch: the previous tokens stay live
			// until this fresh set lands (or the config carries no theme).
			clearThemeTokens(style)
			style.setProperty(
				FONT_MONO_TOKEN,
				familyStackFrom(config.font_family),
			)
			if (!tokens) return
			for (const [name, value] of Object.entries(tokens)) {
				style.setProperty(name, value)
			}
		})

		return () => {
			cancelled = true
		}
	}, [appearance, configEpoch, seedKeybindTable, seedOptionAsAlt])

	// Token removal belongs to UNMOUNT only; tying it to the fetch effect above
	// would strip the live theme on every re-run while the replacement is still
	// in flight.
	useEffect(() => () => clearThemeTokens(document.documentElement.style), [])
}
