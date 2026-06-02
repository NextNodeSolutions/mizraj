import { Store } from '@tauri-apps/plugin-store'
import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Appearance } from '@/features/sessions/ghosttyConfig'

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
	theme: Theme
	lastProjectPath: string | null
}

export const DEFAULT_SETTINGS: Settings = {
	theme: 'system',
	lastProjectPath: null,
}

const SETTINGS_FILE = 'settings.json'

let storePromise: Promise<Store> | null = null

const getStore = async (): Promise<Store> => {
	if (storePromise === null) {
		storePromise = Store.load(SETTINGS_FILE)
	}
	return storePromise
}

const isTheme = (value: unknown): value is Theme =>
	value === 'light' || value === 'dark' || value === 'system'

const readSettings = async (): Promise<Settings> => {
	const store = await getStore()
	const rawTheme = await store.get<unknown>('theme')
	const rawPath = await store.get<unknown>('lastProjectPath')
	return {
		theme: isTheme(rawTheme) ? rawTheme : DEFAULT_SETTINGS.theme,
		lastProjectPath:
			typeof rawPath === 'string'
				? rawPath
				: DEFAULT_SETTINGS.lastProjectPath,
	}
}

const writeSetting = async <K extends keyof Settings>(
	key: K,
	value: Settings[K],
): Promise<void> => {
	const store = await getStore()
	await store.set(key, value)
	await store.save()
}

export type UseSettings = Settings & {
	ready: boolean
	setTheme: (theme: Theme) => Promise<void>
	setLastProjectPath: (path: string | null) => Promise<void>
}

export const useSettings = (): UseSettings => {
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let cancelled = false
		void readSettings().then(loaded => {
			if (!cancelled) {
				setSettings(loaded)
				setReady(true)
			}
		})
		return () => {
			cancelled = true
		}
	}, [])

	const setTheme = async (theme: Theme): Promise<void> => {
		setSettings(prev => ({ ...prev, theme }))
		await writeSetting('theme', theme)
	}

	const setLastProjectPath = async (path: string | null): Promise<void> => {
		setSettings(prev => ({ ...prev, lastProjectPath: path }))
		await writeSetting('lastProjectPath', path)
	}

	return { ...settings, ready, setTheme, setLastProjectPath }
}

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
