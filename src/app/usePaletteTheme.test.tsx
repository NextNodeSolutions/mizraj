import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for the Tauri settings store (same shape as
// settings.test.tsx): enough surface for readSettings, no disk, no IPC.
const backing = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tauri-apps/plugin-store', () => ({
	Store: {
		load: () =>
			Promise.resolve({
				get: (key: string) => Promise.resolve(backing.get(key)),
				set: (key: string, value: unknown) => {
					backing.set(key, value)
					return Promise.resolve()
				},
				save: () => Promise.resolve(),
			}),
	},
}))

import {
	resetSettingsForTests,
	useSettings,
} from '@/features/settings/settings'
import type { UseSettings } from '@/features/settings/settings'

import { usePaletteTheme } from './usePaletteTheme'

const Probe = ({
	capture,
}: {
	capture?: (value: UseSettings) => void
}): null => {
	usePaletteTheme()
	capture?.(useSettings())
	return null
}

describe('usePaletteTheme', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		backing.clear()
		resetSettingsForTests()
		delete document.documentElement.dataset['theme']
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		delete document.documentElement.dataset['theme']
	})

	it('writes the mocha palette on <html data-theme> for a dark appearance', async () => {
		backing.set('theme', 'dark')

		await act(async () => {
			root.render(<Probe />)
		})

		expect(document.documentElement.dataset['theme']).toBe('mocha')
	})

	it('writes the latte palette on <html data-theme> for a light appearance', async () => {
		backing.set('theme', 'light')

		await act(async () => {
			root.render(<Probe />)
		})

		expect(document.documentElement.dataset['theme']).toBe('latte')
	})

	it('re-resolves the palette when the theme setting changes', async () => {
		backing.set('theme', 'light')
		let settings: UseSettings | undefined
		const capture = (value: UseSettings): void => {
			settings = value
		}

		await act(async () => {
			root.render(<Probe capture={capture} />)
		})
		expect(document.documentElement.dataset['theme']).toBe('latte')

		await act(async () => {
			await settings?.setTheme('dark')
		})

		expect(document.documentElement.dataset['theme']).toBe('mocha')
	})
})
