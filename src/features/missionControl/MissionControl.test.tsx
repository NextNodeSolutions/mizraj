import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as RouterModule from '@/app/router'

const { invokeMock, navigateMock, setLastProjectPathMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
	setLastProjectPathMock: vi.fn(),
}))

vi.mock('@/features/settings/settings', async importOriginal => ({
	...(await importOriginal<
		typeof import('@/features/settings/settings')
	>()),
	setLastProjectPath: setLastProjectPathMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

// Only navigate is faked: hrefs, parseMissionFilter and useLocationSearch
// stay real so the URL remains the single source of truth in tests too.
vi.mock('@/app/router', async importOriginal => ({
	...(await importOriginal<typeof RouterModule>()),
	navigate: navigateMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
	Store: {
		load: vi.fn().mockResolvedValue({
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn().mockResolvedValue(undefined),
			save: vi.fn().mockResolvedValue(undefined),
		}),
	},
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { projectsAtom } from '@/features/projects/useProjects'
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
		store.set(projectsAtom, [])
		invokeMock.mockReset()
		invokeMock.mockResolvedValue(undefined)
		navigateMock.mockReset()
		setLastProjectPathMock.mockReset()
		window.history.replaceState({}, '', '/')
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

	const runAgentButton = (): Element | null =>
		Array.from(container.querySelectorAll('button')).find(
			button => button.textContent === 'Run agent',
		) ?? null

	it('shows an empty state inviting a first agent when no session lives', () => {
		render()

		expect(container.textContent).toContain('No agents yet')
		expect(runAgentButton()).not.toBeNull()
	})

	it('omits the run CTA while no project is selected', () => {
		render(null)

		expect(container.textContent).toContain('No agents yet')
		expect(runAgentButton()).toBeNull()
	})

	it('keeps the screen title above the empty state, without filters', () => {
		render()

		expect(container.querySelector('.view-head h2')?.textContent).toBe(
			'Mission Control',
		)
		expect(container.querySelector('.mc-filters')).toBeNull()
		expect(container.querySelector('.mc-empty')).not.toBeNull()
	})

	it('offers a reset chip when the filter hides every agent', () => {
		seedSession('run-1')
		window.history.replaceState({}, '', '/?filter=failed')
		render()

		expect(cards()).toHaveLength(0)
		const empty = container.querySelector('.mc-empty--filter')
		expect(empty?.textContent).toContain('Nothing failed right now.')

		const resetChip = empty?.querySelector('.chip')
		expect(resetChip?.textContent).toContain('Show all')
		expect(resetChip?.textContent).toContain('1')

		act(() => {
			resetChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		expect(navigateMock).toHaveBeenCalledWith('/')
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

	it('shows the live terminal tail on a card, cursor on the last line', () => {
		seedSession('run-1')
		store.set(cellFramesAtom, {
			'run-1': frameOfLines('run-1', ['pnpm test', '14 passing']),
		})
		render()

		const lines = Array.from(
			container.querySelectorAll('.mini-term .term-line'),
		)
		expect(lines[0]?.textContent).toContain('pnpm test')
		expect(lines[1]?.textContent).toContain('14 passing')
		expect(lines[1]?.querySelector('.caret')).not.toBeNull()
	})

	it('shows a waiting prompt while a running card has no output yet', () => {
		seedSession('run-1')
		render()

		const term = container.querySelector('.mini-term')
		expect(term?.textContent).toContain('waiting for output…')
		expect(term?.querySelector('.caret')).not.toBeNull()
	})

	it('renders a review card with idle lines, no cursor, and a review CTA', () => {
		seedSession('done-1', { ended: { exitCode: 0 } })
		render()

		const term = container.querySelector('.mini-term')
		expect(term?.textContent).toContain('done')
		expect(term?.textContent).toContain('⚑ waiting for your review')
		expect(term?.querySelector('.caret')).toBeNull()
		expect(container.querySelector('.gobtn')?.textContent).toBe('Review →')
	})

	it('renders a failed card with its exit code, no cursor', () => {
		seedSession('fail-1', { ended: { exitCode: 9 } })
		render()

		const term = container.querySelector('.mini-term')
		expect(term?.textContent).toContain('✗ exited with code 9')
		expect(term?.textContent).toContain('open to inspect the terminal')
		expect(term?.querySelector('.caret')).toBeNull()
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

	it('filter chips deep-link the status into the URL', () => {
		seedSession('run-1')
		seedSession('done-1', { ended: { exitCode: 0 } })
		render()

		const reviewChip = Array.from(container.querySelectorAll('.chip')).find(
			chip => chip.textContent?.includes('Needs review'),
		)
		expect(reviewChip).toBeDefined()

		act(() => {
			reviewChip?.dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})

		expect(navigateMock).toHaveBeenCalledWith('/?filter=review')
	})

	it('the URL filter narrows the wall and lights its chip', () => {
		seedSession('run-1')
		seedSession('done-1', { ended: { exitCode: 0 } })
		window.history.replaceState({}, '', '/?filter=review')
		render()

		expect(cards()).toHaveLength(1)
		expect(cards()[0]?.getAttribute('data-status')).toBe('review')
		const activeChip = container.querySelector('.chip[data-on="true"]')
		expect(activeChip?.textContent).toContain('Needs review')
	})

	it('counts every chip over all sessions, not the filtered view', () => {
		seedSession('run-1')
		seedSession('done-1', { ended: { exitCode: 0 } })
		window.history.replaceState({}, '', '/?filter=review')
		render()

		const chipTexts = Array.from(container.querySelectorAll('.chip')).map(
			chip => chip.textContent,
		)
		expect(chipTexts).toContain('All2')
		expect(chipTexts).toContain('Running1')
		expect(chipTexts).toContain('Needs review1')
		expect(chipTexts).toContain('Failed0')
	})

	it('heads the screen with its title and the live scope line', () => {
		seedSession('run-1', { repoPath: '/repo/x' })
		seedSession('run-2', { repoPath: '/repo/y' })
		seedSession('done-1', { repoPath: '/repo/x', ended: { exitCode: 0 } })
		render()

		expect(container.querySelector('.view-head h2')?.textContent).toBe(
			'Mission Control',
		)
		expect(container.querySelector('.mc-scope')?.textContent).toBe(
			'2 projects · 2 agents live',
		)
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

	it('shows each card the branch and diff stats of its OWN repo', async () => {
		seedSession('run-a', { repoPath: '/repo/alpha' })
		seedSession('run-b', { repoPath: '/repo/beta' })
		invokeMock.mockImplementation(
			(command: string, args?: { repoPath?: string }) => {
				if (command === 'repo_head') {
					return Promise.resolve({
						branch:
							args?.repoPath === '/repo/alpha'
								? 'feat/alpha-work'
								: 'fix/beta-bug',
						detached: false,
					})
				}
				if (command === 'get_diff') {
					return Promise.resolve({
						patch:
							args?.repoPath === '/repo/alpha'
								? 'diff --git a/a.txt b/a.txt\nindex 000..111 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-old\n+new\n+more\n'
								: '',
					})
				}
				return Promise.resolve(undefined)
			},
		)

		await act(async () => {
			root.render(<MissionControl activeProjectPath="/repo/alpha" />)
		})

		const groups = Array.from(container.querySelectorAll('.proj-group'))
		const alpha = groups.find(group =>
			group.textContent?.includes('alpha'),
		)
		const beta = groups.find(group => group.textContent?.includes('beta'))
		expect(alpha?.textContent).toContain('feat/alpha-work')
		expect(beta?.textContent).toContain('fix/beta-bug')
		expect(alpha?.querySelector('.ac-diff')?.textContent).toContain('+2')
		expect(alpha?.querySelector('.ac-diff')?.textContent).toContain('−1')
		expect(beta?.querySelector('.ac-diff')).toBeNull()
	})

	it('opening a review card from another repo retargets the preference first', async () => {
		seedSession('done-b', {
			repoPath: '/repo/beta',
			ended: { exitCode: 0 },
		})

		await act(async () => {
			root.render(<MissionControl activeProjectPath="/repo/alpha" />)
		})
		await act(async () => {
			cards()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})

		expect(setLastProjectPathMock).toHaveBeenCalledWith('/repo/beta')
		expect(navigateMock).toHaveBeenCalledWith('/review')
	})

	it('folds registered repos without sessions into a compact dormant section', () => {
		seedSession('run-1', { repoPath: '/repo/x' })
		store.set(projectsAtom, ['/repo/x', '/Users/me/dev/sleepy'])
		render()

		// The busy repo keeps its full group; only the idle one goes dormant.
		expect(container.querySelectorAll('.proj-group')).toHaveLength(1)
		const dormant = container.querySelector('.mc-dormant')
		expect(dormant?.textContent).toContain('1 dormant repo')
		// Collapsed by default: no rows until the section is opened.
		expect(dormant?.querySelectorAll('.mc-dormant-row')).toHaveLength(0)

		act(() => {
			dormant
				?.querySelector('.mc-dormant-head')
				?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})

		const row = container.querySelector('.mc-dormant-row')
		expect(row?.textContent).toContain('sleepy')
		expect(row?.textContent).toContain('~/dev/sleepy')
	})

	it('launches a new agent on a dormant repo from its row CTA', () => {
		store.set(projectsAtom, ['/repo/sleepy'])
		seedSession('run-1', { repoPath: '/repo/x' })
		render()

		act(() => {
			container
				.querySelector('.mc-dormant-head')
				?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		act(() => {
			container
				.querySelector('.mc-dormant-row button')
				?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})

		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo/sleepy',
		})
	})

	it('shows dormant repos even when no session lives at all', () => {
		store.set(projectsAtom, ['/repo/sleepy'])
		render()

		expect(container.textContent).toContain('No agents yet')
		expect(container.querySelector('.mc-dormant')).not.toBeNull()
	})

	it('orders running cards before ended ones', () => {
		seedSession('done-1', { ended: { exitCode: 0 } })
		seedSession('run-1')
		render()

		const statuses = cards().map(card => card.getAttribute('data-status'))
		expect(statuses).toEqual(['running', 'review'])
	})
})
