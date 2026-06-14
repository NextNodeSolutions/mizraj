import { Store } from '@tauri-apps/plugin-store'
import { atom, getDefaultStore, useAtomValue } from 'jotai'

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

// App-wide settings state lives in the default jotai store (same pattern as
// ghosttyConfigBridge), NOT in per-hook useState: every useSettings /
// useAppearance instance subscribes to the SAME atom, so a theme change in the
// settings panel reaches the Ghostty theme tokens and every mounted terminal
// canvas immediately.
type SettingsState = Settings & { ready: boolean }

const settingsStateAtom = atom<SettingsState>({
	...DEFAULT_SETTINGS,
	ready: false,
})

// One-shot disk hydration, kicked off by the first atom subscriber. Guarded so
// remounts (e.g. StrictMode) never re-read and clobber an in-flight setter.
let hydrationStarted = false

settingsStateAtom.onMount = (): void => {
	if (hydrationStarted) return
	hydrationStarted = true
	void readSettings().then(loaded => {
		getDefaultStore().set(settingsStateAtom, { ...loaded, ready: true })
	})
}

// Setters update the shared atom first (instant UI propagation), then persist.
const updateSetting = async <K extends keyof Settings>(
	key: K,
	value: Settings[K],
): Promise<void> => {
	const store = getDefaultStore()
	store.set(settingsStateAtom, prev => ({ ...prev, [key]: value }))
	await writeSetting(key, value)
}

const setTheme = async (theme: Theme): Promise<void> =>
	updateSetting('theme', theme)

/**
 * Retarget the project preference from anywhere (e.g. a cross-repo review
 * card): updates the shared atom instantly, then persists. Exported as a
 * module function — distant components need no prop drilling to call it.
 */
export const setLastProjectPath = async (path: string | null): Promise<void> =>
	updateSetting('lastProjectPath', path)

// Test-only escape hatch: drop the cached store and re-arm hydration so suites
// start from a clean slate.
export const resetSettingsForTests = (): void => {
	storePromise = null
	hydrationStarted = false
	getDefaultStore().set(settingsStateAtom, {
		...DEFAULT_SETTINGS,
		ready: false,
	})
}

export type UseSettings = Settings & {
	ready: boolean
	setTheme: (theme: Theme) => Promise<void>
	setLastProjectPath: (path: string | null) => Promise<void>
}

export const useSettings = (): UseSettings => {
	const { ready, ...settings } = useAtomValue(settingsStateAtom)
	return { ...settings, ready, setTheme, setLastProjectPath }
}
