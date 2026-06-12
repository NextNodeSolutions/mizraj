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

import { sessionsAtom, startSessionAtom } from '@/features/sessions/sessions'

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

	it('stays hidden until summoned', async () => {
		await render()

		expect(container.querySelector('.palette')).toBeNull()
	})

	it('opens on cmd+K and claims the shortcut', async () => {
		await render()

		let event: KeyboardEvent | undefined
		await act(async () => {
			event = pressGlobal({ key: 'k', metaKey: true })
		})

		expect(container.querySelector('.palette')).not.toBeNull()
		expect(event?.defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(
			container.querySelector('.palette input'),
		)
	})

	it('closes on Escape', async () => {
		await render()
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		await act(async () => {
			pressGlobal({ key: 'Escape' })
		})

		expect(container.querySelector('.palette')).toBeNull()
	})

	it('filters as the user types', async () => {
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		const input = container.querySelector<HTMLInputElement>(
			'.palette input',
		)
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value',
			)?.set
			setter?.call(input, 'pipeline')
			input?.dispatchEvent(new Event('input', { bubbles: true }))
		})

		const labels = Array.from(
			container.querySelectorAll('.palette li'),
		).map(item => item.firstChild?.textContent)
		expect(labels).toEqual(['Pipeline'])
	})

	it('runs the selected item with Enter and closes', async () => {
		await render()
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		await act(async () => {
			pressGlobal({ key: 'ArrowDown' })
		})
		await act(async () => {
			pressGlobal({ key: 'Enter' })
		})

		expect(window.location.pathname).toBe('/pipeline')
		expect(container.querySelector('.palette')).toBeNull()
	})

	it('runs an item on click', async () => {
		await render()
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		const tasks = Array.from(
			container.querySelectorAll<HTMLElement>('.palette li'),
		).find(item => item.textContent?.includes('Tasks'))
		await act(async () => {
			tasks?.click()
		})

		expect(window.location.pathname).toBe('/tasks')
	})

	it('closes when the backdrop is clicked', async () => {
		await render()
		await act(async () => {
			pressGlobal({ key: 'k', metaKey: true })
		})

		await act(async () => {
			container
				.querySelector<HTMLElement>('.palette-backdrop')
				?.click()
		})

		expect(container.querySelector('.palette')).toBeNull()
	})
})
