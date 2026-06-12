import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for the Tauri settings store: enough surface for
// readSettings/writeSetting, no disk, no IPC.
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

import { resetSettingsForTests, useSettings } from './settings'
import type { UseSettings } from './settings'

// Two sibling components, each with its OWN useSettings call — the regression
// shape: a setTheme through one instance must be observed by the other.
const ThemeProbe = ({
	id,
	capture,
}: {
	id: string
	capture: (id: string, value: UseSettings) => void
}): null => {
	capture(id, useSettings())
	return null
}

describe('useSettings', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		backing.clear()
		resetSettingsForTests()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
	})

	it('propagates setTheme from one hook instance to every other', async () => {
		const seen = new Map<string, UseSettings>()
		const capture = (id: string, value: UseSettings): void => {
			seen.set(id, value)
		}

		await act(async () => {
			root.render(
				<>
					<ThemeProbe id="panel" capture={capture} />
					<ThemeProbe id="canvas" capture={capture} />
				</>,
			)
		})

		expect(seen.get('panel')?.theme).toBe('system')
		expect(seen.get('canvas')?.theme).toBe('system')

		await act(async () => {
			await seen.get('panel')?.setTheme('dark')
		})

		expect(seen.get('panel')?.theme).toBe('dark')
		expect(seen.get('canvas')?.theme).toBe('dark')
		expect(backing.get('theme')).toBe('dark')
	})

	it('hydrates persisted settings into all instances', async () => {
		backing.set('theme', 'light')
		backing.set('lastProjectPath', '/tmp/proj')

		const seen = new Map<string, UseSettings>()
		const capture = (id: string, value: UseSettings): void => {
			seen.set(id, value)
		}

		await act(async () => {
			root.render(
				<>
					<ThemeProbe id="a" capture={capture} />
					<ThemeProbe id="b" capture={capture} />
				</>,
			)
		})

		expect(seen.get('a')).toMatchObject({
			ready: true,
			theme: 'light',
			lastProjectPath: '/tmp/proj',
		})
		expect(seen.get('b')?.theme).toBe('light')
	})
})
