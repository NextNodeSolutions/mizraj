import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
	reviewHref: () => '/review',
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
	cellFramesAtom,
	sessionsAtom,
	startSessionAtom,
	endSessionAtom,
} from '@/features/sessions/sessions'
import type {
	CellFramePayload,
	WireCell,
} from '@/features/sessions/terminalWire'

import { MissionControl } from './MissionControl'

const store = getDefaultStore()

const cell = (ch: string): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
})

const frameOfLines = (
	sessionId: string,
	lines: ReadonlyArray<string>,
): CellFramePayload => {
	const cols = Math.max(...lines.map(line => line.length), 1)
	return {
		session_id: sessionId,
		cols,
		rows: lines.length,
		cells: lines.flatMap(line =>
			Array.from({ length: cols }, (_, col) => cell(line[col] ?? ' ')),
		),
		cursor: null,
		mouse_reporting: false,
		viewport_top: 0,
		history_total: 0,
	}
}

const seedSession = (
	id: string,
	overrides: {
		binary?: string
		repoPath?: string | null
		ended?: { exitCode: number }
	} = {},
): void => {
	store.set(startSessionAtom, {
		id,
		binary: overrides.binary ?? 'claude',
		repoPath:
			overrides.repoPath === undefined
				? '/Users/me/dev/mizraj'
				: overrides.repoPath,
	})
	if (overrides.ended) {
		store.set(endSessionAtom, {
			sessionId: id,
			exitCode: overrides.ended.exitCode,
		})
	}
}

describe('MissionControl', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(cellFramesAtom, {})
		invokeMock.mockReset()
		invokeMock.mockResolvedValue(undefined)
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

	const render = (activeProjectPath: string | null = '/repo'): void => {
		act(() => {
			root.render(
				<MissionControl activeProjectPath={activeProjectPath} />,
			)
		})
	}

	const cards = (): ReadonlyArray<Element> =>
		Array.from(container.querySelectorAll('.agent-card'))

	it('shows an empty state inviting a first agent when no session lives', () => {
		render()

		expect(container.textContent).toContain('No agents yet')
		expect(container.querySelector('.run-agent-button')).not.toBeNull()
	})

	it('omits the run CTA while no project is selected', () => {
		render(null)

		expect(container.textContent).toContain('No agents yet')
		expect(container.querySelector('.run-agent-button')).toBeNull()
	})

	it('renders one card per session with its derived status', () => {
		seedSession('run-1')
		seedSession('done-1', { ended: { exitCode: 0 } })
		seedSession('fail-1', { ended: { exitCode: 9 } })
		render()

		expect(cards()).toHaveLength(3)
		expect(container.textContent).toContain('running')
		expect(container.textContent).toContain('needs review')
		expect(container.textContent).toContain('failed')
	})

	it('shows the live terminal tail on a card', () => {
		seedSession('run-1')
		store.set(cellFramesAtom, {
			'run-1': frameOfLines('run-1', ['pnpm test', '14 passing']),
		})
		render()

		const term = container.querySelector('.agent-card__term')
		expect(term?.textContent).toContain('pnpm test')
		expect(term?.textContent).toContain('14 passing')
	})

	it('subscribes each visible session to cell frames and releases on unmount', () => {
		seedSession('run-1')
		render()

		expect(invokeMock).toHaveBeenCalledWith('session_subscribe', {
			sessionId: 'run-1',
		})

		act(() => {
			root.render(<span />)
		})
		expect(invokeMock).toHaveBeenCalledWith('session_unsubscribe', {
			sessionId: 'run-1',
		})
	})

	it('opens the cockpit for a running card', () => {
		seedSession('run-1')
		render()

		act(() => {
			cards()[0]?.dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})

		expect(navigateMock).toHaveBeenCalledWith('/agent-run/run-1')
	})

	it('opens the review screen for a needs-review card', () => {
		seedSession('done-1', { ended: { exitCode: 0 } })
		render()

		act(() => {
			cards()[0]?.dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})

		expect(navigateMock).toHaveBeenCalledWith('/review')
	})

	it('filter chips narrow the grid to one status', () => {
		seedSession('run-1')
		seedSession('done-1', { ended: { exitCode: 0 } })
		render()

		const reviewChip = Array.from(
			container.querySelectorAll('.mission-control__chip'),
		).find(chip => chip.textContent?.includes('Needs review'))
		expect(reviewChip).toBeDefined()

		act(() => {
			reviewChip?.dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})

		expect(cards()).toHaveLength(1)
		expect(container.textContent).toContain('needs review')
	})

	it('groups cards per project with the repo name and compacted path', () => {
		seedSession('run-1', { repoPath: '/Users/me/dev/mizraj' })
		seedSession('run-2', { repoPath: '/Users/me/dev/api' })
		render()

		const groups = Array.from(container.querySelectorAll('.proj-group'))
		expect(groups).toHaveLength(2)
		const names = groups.map(
			group => group.querySelector('.proj-name')?.textContent,
		)
		expect(names).toContain('mizraj')
		expect(names).toContain('api')
		expect(groups[0]?.querySelector('.proj-dir')?.textContent).toContain(
			'~/dev/',
		)
		expect(groups[0]?.getAttribute('data-hue')).not.toBeNull()
	})

	it('sums each status in the group header, over the whole group', () => {
		seedSession('run-1')
		seedSession('run-2')
		seedSession('done-1', { ended: { exitCode: 0 } })
		seedSession('fail-1', { ended: { exitCode: 9 } })
		render()

		const stats = container.querySelector('.proj-stats')
		expect(stats?.textContent).toContain('2 running')
		expect(stats?.textContent).toContain('1 review')
		expect(stats?.textContent).toContain('1 failed')
	})

	it('folds a project on header click and reopens it on the next', () => {
		seedSession('run-1')
		render()

		const head = container.querySelector('.proj-head')
		expect(head?.getAttribute('aria-expanded')).toBe('true')

		act(() => {
			head?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		expect(cards()).toHaveLength(0)
		expect(
			container
				.querySelector('.proj-head')
				?.getAttribute('aria-expanded'),
		).toBe('false')

		act(() => {
			container
				.querySelector('.proj-head')
				?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		expect(cards()).toHaveLength(1)
	})

	it('launches a claude agent in the project from the header + button, without folding', () => {
		seedSession('run-1', { repoPath: '/repo/x' })
		seedSession('loose-1', { repoPath: null })
		render()

		const addButtons = Array.from(container.querySelectorAll('.proj-add'))
		// The repo-less bucket cannot host a launch — no cwd to give it.
		expect(addButtons).toHaveLength(1)

		act(() => {
			addButtons[0]?.dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})

		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo/x',
		})
		expect(cards().length).toBeGreaterThan(0)
	})

	it('puts the active project first and the repo-less bucket last', () => {
		seedSession('loose-1', { repoPath: null })
		seedSession('busy-1', { repoPath: '/repo/busy' })
		seedSession('active-1', { repoPath: '/repo/active' })
		render('/repo/active')

		const names = Array.from(container.querySelectorAll('.proj-name')).map(
			node => node.textContent,
		)
		expect(names).toEqual(['active', 'busy', 'no project'])
	})

	it('orders running cards before ended ones', () => {
		seedSession('done-1', { ended: { exitCode: 0 } })
		seedSession('run-1')
		render()

		const statuses = cards().map(card => card.getAttribute('data-status'))
		expect(statuses).toEqual(['running', 'review'])
	})
})
