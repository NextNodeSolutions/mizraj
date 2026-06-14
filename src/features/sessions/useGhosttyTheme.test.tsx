import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}))

// In-memory stand-in for the Tauri settings store (useAppearance reads the
// theme setting): enough surface for readSettings, no disk, no IPC.
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

import { invoke } from '@tauri-apps/api/core'

import { resetSettingsForTests } from '@/features/settings/settings'

import {
	DEFAULT_FONT_STACK,
	EMPTY_CONFIG,
	GLYPH_FALLBACK_STACK,
} from './ghosttyConfig'
import type { GhosttyConfig } from './ghosttyConfig'
import { useGhosttyTheme } from './useGhosttyTheme'

const invokeMock = vi.mocked(invoke)

const Probe = (): null => {
	useGhosttyTheme()
	return null
}

const fontMonoOnHtml = (): string =>
	document.documentElement.style.getPropertyValue('--font-mono')

describe('useGhosttyTheme mono font stack', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		backing.clear()
		resetSettingsForTests()
		document.documentElement.style.removeProperty('--font-mono')
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		document.documentElement.style.removeProperty('--font-mono')
	})

	const mountWithConfig = async (
		config: Partial<GhosttyConfig>,
	): Promise<void> => {
		invokeMock.mockResolvedValue({ ...EMPTY_CONFIG, ...config })
		await act(async () => {
			root.render(<Probe />)
		})
	}

	it('writes the configured families plus glyph fallbacks on <html>, even with no colors in the config', async () => {
		await mountWithConfig({
			font_family: ['MonoLisa Nerd Font Mono'],
			background: null,
		})

		expect(fontMonoOnHtml()).toBe(
			`MonoLisa Nerd Font Mono, ${GLYPH_FALLBACK_STACK}`,
		)
	})

	it('falls back to the bundled default stack when the config sets no fonts', async () => {
		await mountWithConfig({})

		expect(fontMonoOnHtml()).toBe(DEFAULT_FONT_STACK)
	})

	it('removes the token on unmount, like the color tokens', async () => {
		await mountWithConfig({ font_family: ['MonoLisa Nerd Font Mono'] })
		expect(fontMonoOnHtml()).not.toBe('')

		act(() => root.unmount())

		expect(fontMonoOnHtml()).toBe('')
	})
})
