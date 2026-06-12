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

		const headings = Array.from(container.querySelectorAll('.lgroup')).map(
			heading => heading.textContent,
		)
		expect(headings).toEqual(['Running · 2', 'Ended · 1'])
	})

	it('shows the panel head with the total session count', () => {
		seed('run-1')
		seed('run-2')
		seed('done-1', { exitCode: 0 })
		render('run-1')

		expect(container.querySelector('.panel-head h3')?.textContent).toBe(
			'Sessions',
		)
		expect(
			container.querySelector('.panel-head .ph-count')?.textContent,
		).toBe('3')
	})

	it('marks the open session as current', () => {
		seed('run-1')
		seed('run-2')
		render('run-2')

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.textContent).toContain('claude')
		expect(current?.getAttribute('href')).toBe('/agent-run/run-2')
		expect(current?.getAttribute('data-on')).toBe('true')
	})

	it('navigates to a session on click', () => {
		seed('run-1')
		seed('run-2')
		render('run-1')

		const links = container.querySelectorAll<HTMLElement>('.lrow')
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

	it('metas running rows with repo · age and ended rows with repo · status', () => {
		seed('run-1')
		seed('rev-1', { exitCode: 0 })
		seed('fail-1', { exitCode: 1 })
		render('run-1')

		const metas = Array.from(container.querySelectorAll('.lrow .lr-b')).map(
			meta => meta.textContent,
		)
		expect(metas).toEqual([
			'mizraj · 0s',
			'mizraj · needs review',
			'mizraj · failed',
		])
	})

	it('hints the global palette shortcut in the panel foot', () => {
		seed('run-1')
		render('run-1')

		const foot = container.querySelector('.fc-sess-foot')
		expect(foot?.querySelector('.mz-kbd')?.textContent).toBe('⌘K')
		expect(foot?.textContent).toContain('jump between agents')
	})

	it('dots rows with the session display status', () => {
		seed('run-1')
		seed('rev-1', { exitCode: 0 })
		seed('fail-1', { exitCode: 1 })
		render('run-1')

		const dots = Array.from(container.querySelectorAll('.lrow .sdot')).map(
			dot => dot.className,
		)
		expect(dots).toEqual([
			'sdot sdot-run',
			'sdot sdot-rev',
			'sdot sdot-fail',
		])
	})
})
