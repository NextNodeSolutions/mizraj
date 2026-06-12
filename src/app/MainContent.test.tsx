import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { sessionsAtom } from '@/features/sessions/sessions'

import { MainContent } from './MainContent'
import { navigate } from './router'

const store = getDefaultStore()

describe('MainContent', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
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

	const render = (): void => {
		act(() => {
			root.render(<MainContent activeProjectPath={null} />)
		})
	}

	it('wraps the routed screen in an animated view container', () => {
		render()

		const view = container.querySelector('.mz-views > .mz-view')
		expect(view?.getAttribute('data-state')).toBe('in')
		expect(
			view?.querySelector('[aria-label="Mission control"]'),
		).not.toBeNull()
	})

	it('shows the empty cockpit on /agent-run without a session', () => {
		window.history.pushState({}, '', '/agent-run')
		render()

		expect(container.querySelector('.fc-empty p')?.textContent).toBe(
			'No session yet — launch an agent or open a terminal.',
		)
	})

	it('keeps the view container across param-only changes', () => {
		window.history.pushState({}, '', '/plans')
		render()
		const before = container.querySelector('.mz-view')

		act(() => {
			navigate('/plans/plan/auth')
		})

		const after = container.querySelector('.mz-view')
		expect(before !== null && after !== null).toBe(true)
		expect(before === after).toBe(true)
	})

	it('remounts the view container when the screen changes', () => {
		window.history.pushState({}, '', '/plans')
		render()
		const before = container.querySelector('.mz-view')

		act(() => {
			navigate('/pipeline')
		})

		const after = container.querySelector('.mz-view')
		expect(before !== null && after !== null).toBe(true)
		expect(before === after).toBe(false)
	})
})
