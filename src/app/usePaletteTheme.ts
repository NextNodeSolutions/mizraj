import { useEffect } from 'react'

import { useAppearance } from '@/features/settings/useAppearance'

// The v2 stylesheet themes (tokens.css) are keyed by CONCRETE palette name
// (html[data-theme="latte|frappe|macchiato|mocha"]), so <html data-theme>
// carries the RESOLVED palette — never the raw light/dark/system setting.
// Reachable set today: latte (light) / mocha (dark); frappé/macchiato ship
// in tokens.css for a future setting. Resolution (incl. live OS changes for
// 'system') is useAppearance's job — one source of truth with the Ghostty
// config loader.
export const usePaletteTheme = (): void => {
	const appearance = useAppearance()
	useEffect(() => {
		document.documentElement.dataset['theme'] =
			appearance === 'dark' ? 'mocha' : 'latte'
	}, [appearance])
}
