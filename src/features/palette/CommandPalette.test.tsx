import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import {
	activeSessionIdAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { CommandPalette } from './CommandPalette'
import { paletteOpenAtom } from './palette'

const store = getDefaultStore()

const pressGlobal = (init: KeyboardEventInit): KeyboardEvent => {
	const event = new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		...init,
	})
	window.dispatchEvent(event)
	return event
}

describe('CommandPalette', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(activeSessionIdAtom, null)
		store.set(paletteOpenAtom, false)
		invokeMock.mockReset()
		invokeMock.mockResolvedValue([])
		window.history.pushState({}, '', '/')
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	const render = async (): Promise<void> => {
		await act(async () => {
			root.render(<CommandPalette activeProjectPath="/repo" />)
		})
	}

	const palette = (): Element | null => container.querySelector('.palette')

	const open = async (): Promise<void> => {
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})
	}

	const type = async (value: string): Promise<void> => {
		const input =
			container.querySelector<HTMLInputElement>('.palette input')
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value',
			)?.set
			setter?.call(input, value)
			input?.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}

	it('stays mounted but closed until summoned', async () => {
		await render()

		expect(palette()?.getAttribute('data-open')).toBe('false')
		expect(
			container.querySelector('.pal-back')?.getAttribute('data-open'),
		).toBe('false')
	})

	it('opens on cmd+K, claims the shortcut and focuses the input', async () => {
		await render()

		let event: KeyboardEvent | undefined
		await act(async () => {
			event = pressGlobal({ key: 'k', metaKey: true })
		})

		expect(palette()?.getAttribute('data-open')).toBe('true')
		expect(event?.defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(
			container.querySelector('.palette input'),
		)
	})

	it('closes on Escape and returns the keyboard', async () => {
		await render()
		await open()

		await act(async () => {
			pressGlobal({ key: 'Escape' })
		})

		expect(palette()?.getAttribute('data-open')).toBe('false')
		expect(document.activeElement).not.toBe(
			container.querySelector('.palette input'),
		)
	})

	it('filters as the user types', async () => {
		await render()
		await open()

		await type('pipeline')

		const labels = Array.from(container.querySelectorAll('.pal-item')).map(
			item => item.firstChild?.textContent,
		)
		expect(labels).toEqual(['Pipeline board'])
	})

	it('shows the design empty copy when nothing matches', async () => {
		await render()
		await open()

		await type('zzz')

		expect(container.querySelector('.pal-empty')?.textContent).toBe(
			'no results for “zzz”',
		)
	})

	it('groups items under their section heading', async () => {
		await render()
		await open()

		const groups = Array.from(container.querySelectorAll('.pal-group')).map(
			group => group.textContent,
		)
		expect(groups).toEqual(['Go to', 'Actions'])
	})

	it('runs the selected item with Enter and closes', async () => {
		await render()
		await open()

		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})
		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})
		await act(async () => {
			pressGlobal({ key: 'Enter' })
		})

		expect(window.location.pathname).toBe('/pipeline')
		expect(palette()?.getAttribute('data-open')).toBe('false')
	})

	it('moves the selection with the pointer', async () => {
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()
		await open()

		const items = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		)
		expect(items[0]?.getAttribute('data-on')).toBe('true')

		await act(async () => {
			items[2]?.dispatchEvent(
				new MouseEvent('mouseover', { bubbles: true }),
			)
		})

		expect(items[2]?.getAttribute('data-on')).toBe('true')
		expect(items[0]?.getAttribute('data-on')).toBe('false')
	})

	it('runs an item on click', async () => {
		await render()
		await open()

		const tasks = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		).find(item => item.textContent?.includes('Tasks'))
		await act(async () => {
			tasks?.click()
		})

		expect(window.location.pathname).toBe('/tasks')
	})

	it('closes when the backdrop is clicked', async () => {
		await render()
		await open()

		await act(async () => {
			container.querySelector<HTMLElement>('.pal-back')?.click()
		})

		expect(palette()?.getAttribute('data-open')).toBe('false')
	})

	it('walks the selection back up with ArrowUp', async () => {
		await render()
		await open()

		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})
		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})
		await act(async () => {
			pressGlobal({ key: 'ArrowUp' })
		})

		const items = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		)
		expect(items[1]?.getAttribute('data-on')).toBe('true')
		expect(items[0]?.getAttribute('data-on')).toBe('false')
		expect(items[2]?.getAttribute('data-on')).toBe('false')
	})

	it('a second cmd+K closes the open palette', async () => {
		await render()
		await open()
		expect(palette()?.getAttribute('data-open')).toBe('true')

		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		expect(palette()?.getAttribute('data-open')).toBe('false')
	})

	it('points aria-activedescendant at the highlighted option', async () => {
		await render()
		await open()

		const input =
			container.querySelector<HTMLInputElement>('.palette input')
		const items = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		)
		expect(input?.getAttribute('aria-activedescendant')).toBe(items[0]?.id)
		expect(input?.getAttribute('role')).toBe('combobox')
		expect(input?.getAttribute('aria-controls')).toBe(
			container.querySelector('.pal-list')?.id,
		)

		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})

		expect(input?.getAttribute('aria-activedescendant')).toBe(items[1]?.id)
	})

	it('clamps the selection when the filtered list shrinks below it', async () => {
		// Two sessions sit at the top of the list as "Agents" rows.
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(startSessionAtom, {
			id: 'sess-2',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()
		await open()

		// Drop the highlight onto the last option of the full list — every
		// ArrowDown is an independent synchronous dispatch, so one act suffices.
		const fullCount = container.querySelectorAll('.pal-item').length
		await act(async () => {
			for (let step = 0; step < fullCount; step += 1) {
				pressGlobal({ key: 'ArrowDown' })
			}
		})
		const lastFull = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		).at(-1)
		expect(lastFull?.getAttribute('data-on')).toBe('true')

		// Removing the sessions shrinks the list under the held selection.
		await act(async () => {
			store.set(sessionsAtom, {})
		})

		const items = Array.from(
			container.querySelectorAll<HTMLElement>('.pal-item'),
		)
		// The highlight clamps onto the new last row, never an out-of-range slot.
		expect(items.length).toBeLessThan(fullCount)
		expect(items.at(-1)?.getAttribute('data-on')).toBe('true')
		expect(
			items.filter(item => item.getAttribute('data-on') === 'true'),
		).toHaveLength(1)
		// aria-activedescendant follows the clamp to a real option id.
		const input =
			container.querySelector<HTMLInputElement>('.palette input')
		expect(input?.getAttribute('aria-activedescendant')).toBe(
			items.at(-1)?.id,
		)
	})
})
