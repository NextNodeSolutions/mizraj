import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
}))

import { CockpitSessions } from './CockpitSessions'
import { endSessionAtom, sessionsAtom, startSessionAtom } from './sessions'

const store = getDefaultStore()

describe('CockpitSessions', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		navigateMock.mockReset()
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

	const seed = (id: string, ended?: { exitCode: number }): void => {
		store.set(startSessionAtom, {
			id,
			binary: 'claude',
			repoPath: '/repo/mizraj',
		})
		if (ended) {
			store.set(endSessionAtom, {
				sessionId: id,
				exitCode: ended.exitCode,
			})
		}
	}

	const render = (activeSessionId: string): void => {
		act(() => {
			root.render(<CockpitSessions activeSessionId={activeSessionId} />)
		})
	}

	it('groups sessions under running and ended headings with counts', () => {
		seed('run-1')
		seed('run-2')
		seed('done-1', { exitCode: 0 })
		render('run-1')

		const headings = Array.from(
			container.querySelectorAll('.cockpit-sessions__group'),
		).map(heading => heading.textContent)
		expect(headings).toEqual(['Running · 2', 'Ended · 1'])
	})

	it('marks the open session as current', () => {
		seed('run-1')
		seed('run-2')
		render('run-2')

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.textContent).toContain('claude')
		expect(current?.getAttribute('href')).toBe('/agent-run/run-2')
	})

	it('navigates to a session on click', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		const links = container.querySelectorAll<HTMLElement>(
			'.cockpit-sessions__row',
		)
		act(() => {
			links[1]?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/agent-run/run-2')
	})

	it('shows nothing for a group without sessions', () => {
		seed('run-1')
		render('run-1')

		expect(container.textContent).not.toContain('Ended')
	})
})
