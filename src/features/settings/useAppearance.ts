import { useSyncExternalStore } from 'react'

import type { Appearance } from '@/features/sessions/ghosttyConfig'

import { useSettings } from './settings'

// The OS-level dark-mode query. Resolving `system` against it is a genuine
// external-system read, so it goes through useSyncExternalStore rather than an
// ad-hoc effect: the snapshot is `.matches`, and subscribing to its `change`
// event is what makes a live OS theme switch propagate to the whole app.
// matchMedia exists in the Tauri webview at runtime, but guard it anyway so a
// non-DOM test/SSR context falls back to "not dark" instead of throwing.
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

const prefersDarkQuery = (): MediaQueryList | null => {
	if (typeof window === 'undefined' || !window.matchMedia) return null
	return window.matchMedia(DARK_SCHEME_QUERY)
}

const subscribeToColorScheme = (onChange: () => void): (() => void) => {
	const query = prefersDarkQuery()
	if (!query) return () => {}
	query.addEventListener('change', onChange)
	return () => query.removeEventListener('change', onChange)
}

const getColorSchemeIsDark = (): boolean => prefersDarkQuery()?.matches ?? false

// The light/dark axis the Ghostty config loader and the app chrome key off.
// An explicit `light`/`dark` setting wins outright; `system` follows the OS and
// updates live via the media-query subscription above.
export const useAppearance = (): Appearance => {
	const { theme } = useSettings()
	const systemPrefersDark = useSyncExternalStore(
		subscribeToColorScheme,
		getColorSchemeIsDark,
		getColorSchemeIsDark,
	)
	if (theme === 'light') return 'light'
	if (theme === 'dark') return 'dark'
	return systemPrefersDark ? 'dark' : 'light'
}
