import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	activeSessionIdAtom,
	endSessionAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { Rail } from './Rail'

const store = getDefaultStore()

describe('Rail', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(activeSessionIdAtom, null)
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
			root.render(<Rail />)
		})
	}

	const button = (label: string): HTMLElement | null =>
		container.querySelector<HTMLElement>(
			`.mz-railbtn[aria-label="${label}"]`,
		)

	it('offers the five views with icon and label', () => {
		render()

		const labels = Array.from(
			container.querySelectorAll('.mz-rail .mz-railbtn .rl'),
		).map(label => label.textContent)
		expect(labels).toEqual([
			'Agents',
			'Cockpit',
			'Board',
			'Plans',
			'Review',
		])
		expect(container.querySelectorAll('.mz-railbtn svg')).toHaveLength(5)
	})

	it('marks the view owning the current route, including deep links', () => {
		window.history.pushState({}, '', '/plans/plan/auth')
		render()

		expect(button('Plans')?.getAttribute('data-on')).toBe('true')
		expect(button('Agents')?.getAttribute('data-on')).toBe('false')

		act(() => {
			button('Review')?.click()
		})

		expect(button('Review')?.getAttribute('data-on')).toBe('true')
		expect(button('Plans')?.getAttribute('data-on')).toBe('false')
	})

	it('claims the cockpit on both session panes and the empty state', () => {
		window.history.pushState({}, '', '/agent-run/sess-1')
		render()
		expect(button('Cockpit')?.getAttribute('data-on')).toBe('true')

		act(() => {
			window.history.pushState({}, '', '/agent-run')
			window.dispatchEvent(new PopStateEvent('popstate'))
		})
		expect(button('Cockpit')?.getAttribute('data-on')).toBe('true')
	})

	it('badges the review button with the needs-review count', () => {
		store.set(startSessionAtom, {
			id: 'done-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(startSessionAtom, {
			id: 'done-2',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(endSessionAtom, { sessionId: 'done-1', exitCode: 0 })
		store.set(endSessionAtom, { sessionId: 'done-2', exitCode: 0 })
		render()

		expect(
			button('Review')?.querySelector('.rail-badge')?.textContent,
		).toBe('2')
	})

	it('hides the badge while nothing needs review', () => {
		store.set(startSessionAtom, {
			id: 'live',
			binary: 'claude',
			repoPath: '/repo',
		})
		render()

		expect(button('Review')?.querySelector('.rail-badge')).toBeNull()
	})

	it('routes the cockpit to the active session', () => {
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(startSessionAtom, {
			id: 'sess-2',
			binary: 'zsh',
			repoPath: '/repo',
		})
		store.set(activeSessionIdAtom, 'sess-2')
		render()

		act(() => {
			button('Cockpit')?.click()
		})

		expect(window.location.pathname).toBe('/agent-run/sess-2')
	})

	it('routes the cockpit to its empty state without sessions', () => {
		render()

		act(() => {
			button('Cockpit')?.click()
		})

		expect(window.location.pathname).toBe('/agent-run')
	})

	it('navigates to each static view', () => {
		render()

		act(() => {
			button('Board')?.click()
		})
		expect(window.location.pathname).toBe('/pipeline')

		act(() => {
			button('Plans')?.click()
		})
		expect(window.location.pathname).toBe('/plans')

		act(() => {
			button('Review')?.click()
		})
		expect(window.location.pathname).toBe('/review')

		act(() => {
			button('Agents')?.click()
		})
		expect(window.location.pathname).toBe('/')
	})
})
