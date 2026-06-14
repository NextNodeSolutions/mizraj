import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.hoisted(() => vi.fn())
const launchSessionMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
}))

vi.mock('./launchSession', () => ({
	launchSession: launchSessionMock,
}))

import { CockpitSessions } from './CockpitSessions'
import { endSessionAtom, sessionsAtom, startSessionAtom } from './sessions'

const store = getDefaultStore()

// A fixed epoch so seed-time startedAt and useNow's initial read share one
// clock — the '0s' age cannot flake across a 1000ms boundary.
const FROZEN_NOW = new Date('2026-06-14T12:00:00.000Z').getTime()

describe('CockpitSessions', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		navigateMock.mockReset()
		launchSessionMock.mockReset()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
		// Restore the real clock even if a frozen-time test threw before its own
		// teardown, so fake timers never leak into the next test.
		vi.useRealTimers()
	})

	const seed = (
		id: string,
		ended?: { exitCode: number },
		repoPath = '/repo/mizraj',
	): void => {
		store.set(startSessionAtom, {
			id,
			binary: 'claude',
			repoPath,
		})
		if (ended) {
			store.set(endSessionAtom, {
				sessionId: id,
				exitCode: ended.exitCode,
			})
		}
	}

	const render = (
		activeSessionId: string,
		activeProjectPath: string | null = null,
	): void => {
		act(() => {
			root.render(
				<CockpitSessions
					activeSessionId={activeSessionId}
					activeProjectPath={activeProjectPath}
				/>,
			)
		})
	}

	const newSessionButton = (): HTMLButtonElement | null =>
		container.querySelector<HTMLButtonElement>(
			'button[aria-label="New session"]',
		)

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

	it('lists only sessions of the followed repo', () => {
		// Freeze the clock so startedAt and useNow's initial read share it and
		// the age cannot tick to 1s on a millisecond boundary.
		vi.useFakeTimers()
		vi.setSystemTime(FROZEN_NOW)
		seed('mizraj-1')
		seed('scribe-1', undefined, '/repo/scribe')
		render('mizraj-1', '/repo/mizraj')

		expect(container.querySelectorAll('.lrow')).toHaveLength(1)
		expect(
			container.querySelector('.panel-head .ph-count')?.textContent,
		).toBe('1')
		const metas = Array.from(container.querySelectorAll('.lr-b')).map(
			meta => meta.textContent,
		)
		// Scoped to one repo, the row drops the repo chip — it is redundant.
		expect(metas).toEqual(['0s'])
	})

	it('shows sessions from every repo when no repo is followed', () => {
		seed('mizraj-1')
		seed('scribe-1', undefined, '/repo/scribe')
		render('mizraj-1', null)

		expect(container.querySelectorAll('.lrow')).toHaveLength(2)
	})

	it('shows nothing for a group without sessions', () => {
		seed('run-1')
		render('run-1')

		expect(container.textContent).not.toContain('Ended')
	})

	it('metas running rows with repo · age and ended rows with repo · status', () => {
		vi.useFakeTimers()
		vi.setSystemTime(FROZEN_NOW)
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

	it('hides the new-session button without an active project', () => {
		seed('run-1')
		render('run-1')

		expect(newSessionButton()).toBeNull()
	})

	it('launches a claude session in the active project from the head button', () => {
		launchSessionMock.mockReturnValue(new Promise(() => {}))
		seed('run-1')
		render('run-1', '/repo/mizraj')

		const button = newSessionButton()
		expect(button).not.toBeNull()
		act(() => {
			button?.click()
		})

		expect(launchSessionMock).toHaveBeenCalledExactlyOnceWith({
			binary: 'claude',
			repoPath: '/repo/mizraj',
		})
		expect(newSessionButton()?.disabled).toBe(true)
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
