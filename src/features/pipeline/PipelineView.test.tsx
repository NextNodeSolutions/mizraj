import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock, writeTextMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
	writeTextMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
	readText: vi.fn(),
	writeText: writeTextMock,
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
	endSessionAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'
import type { Overview } from '@/features/tasks/tasks'

import { PipelineView } from './PipelineView'

const store = getDefaultStore()

const OVERVIEW: Overview = {
	milestones: [
		{
			id: 'm1',
			number: 1,
			demo: 'demo',
			skeleton: false,
			needs: [],
			tracks: [
				{
					id: 't1',
					branch: 'feat/rate-limit',
					tasks: [
						{
							id: 'task-backlog',
							identifier: 'T1',
							origin: 'track',
							milestoneId: 'm1',
							trackId: 't1',
							step: null,
							title: 'Add rate limiting',
							description: 'Token bucket.',
							doneWhen: null,
							size: 'M',
							sliceOf: [],
							sinkId: null,
							position: 0,
							status: 'backlog',
							blockedReason: null,
							commitSha: null,
							createdAt: '2026-01-01T00:00:00Z',
						},
						{
							id: 'task-blocked',
							identifier: 'T2',
							origin: 'track',
							milestoneId: 'm1',
							trackId: 't1',
							step: null,
							title: 'Blocked work',
							description: null,
							doneWhen: null,
							size: 'S',
							sliceOf: [],
							sinkId: null,
							position: 1,
							status: 'blocked',
							blockedReason: 'waiting on infra',
							commitSha: null,
							createdAt: '2026-01-01T00:00:00Z',
						},
						{
							id: 'task-wip',
							identifier: 'T3',
							origin: 'track',
							milestoneId: 'm1',
							trackId: 't1',
							step: null,
							title: 'Refactor auth',
							description: null,
							doneWhen: null,
							size: 'L',
							sliceOf: [],
							sinkId: null,
							position: 2,
							status: 'in_progress',
							blockedReason: null,
							commitSha: null,
							createdAt: '2026-01-01T00:00:00Z',
						},
						{
							id: 'task-done',
							identifier: 'T4',
							origin: 'track',
							milestoneId: 'm1',
							trackId: 't1',
							step: null,
							title: 'CSV export',
							description: null,
							doneWhen: null,
							size: null,
							sliceOf: [],
							sinkId: null,
							position: 3,
							status: 'done',
							blockedReason: null,
							commitSha: null,
							createdAt: '2026-01-01T00:00:00Z',
						},
					],
				},
			],
		},
	],
	userTasks: [],
}

describe('PipelineView', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
		invokeMock.mockImplementation((command: string) => {
			if (command === 'tasks_overview') return Promise.resolve(OVERVIEW)
			if (command === 'session_create') return Promise.resolve('sess-9')
			return Promise.resolve(undefined)
		})
		navigateMock.mockReset()
		writeTextMock.mockReset()
		writeTextMock.mockResolvedValue(undefined)
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

	const render = async (repoPath: string | null = '/repo'): Promise<void> => {
		await act(async () => {
			root.render(<PipelineView activeProjectPath={repoPath} />)
		})
	}

	const column = (name: string): Element | undefined =>
		Array.from(container.querySelectorAll('.pipeline__col')).find(col =>
			col.querySelector('h3')?.textContent?.includes(name),
		)

	it('lays out the four columns with their counts', async () => {
		store.set(startSessionAtom, {
			id: 'run-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		expect(column('Backlog')?.textContent).toContain('2')
		expect(column('Running')?.textContent).toContain('Refactor auth')
		expect(column('Running')?.textContent).toContain('claude')
		expect(column('Done')?.textContent).toContain('CSV export')
	})

	it('marks each column head with its status dot', async () => {
		await render()

		expect(
			column('Backlog')?.querySelector('.pipeline__col-head .sdot')
				?.className,
		).toBe('sdot sdot-done')
		expect(
			column('Running')?.querySelector('.pipeline__col-head .sdot-run'),
		).not.toBeNull()
		expect(
			column('Review')?.querySelector('.pipeline__col-head .sdot-rev'),
		).not.toBeNull()
		expect(
			column('Done')?.querySelector('.pipeline__col-head .sdot-done'),
		).not.toBeNull()
	})

	it('staggers the column entrance left to right', async () => {
		await render()

		const delays = Array.from(
			container.querySelectorAll<HTMLElement>('.pipeline__col'),
		).map(col => col.style.animationDelay)
		expect(delays).toEqual(['0ms', '45ms', '90ms', '135ms'])
	})

	it('shows idle copy in empty backlog and review columns', async () => {
		invokeMock.mockImplementation((command: string) =>
			command === 'tasks_overview'
				? Promise.resolve({ milestones: [], userTasks: [] })
				: Promise.resolve(undefined),
		)
		await render()

		expect(column('Backlog')?.textContent).toContain(
			'backlog clear — every task has an agent',
		)
		expect(column('Review')?.textContent).toContain(
			'nothing waiting on you',
		)
		expect(column('Running')?.querySelector('.pipeline__empty')).toBeNull()
		expect(column('Done')?.querySelector('.pipeline__empty')).toBeNull()
	})

	it('renders the track branch as an arrow ref on task cards', async () => {
		await render()

		const card = Array.from(
			column('Backlog')?.querySelectorAll('.pipeline__card') ?? [],
		).find(candidate =>
			candidate.textContent?.includes('Add rate limiting'),
		)
		expect(card?.querySelector('.pipeline__branch')?.textContent).toBe(
			'→ feat/rate-limit',
		)
	})

	it('makes only the first backlog launch primary', async () => {
		await render()

		const launches = Array.from(
			column('Backlog')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).filter(button => button.textContent?.includes('Launch agent'))
		expect(launches[0]?.className).toContain('btn-primary')
		expect(launches[1]?.className).toContain('btn-outline')
		expect(launches[1]?.className).not.toContain('btn-primary')
	})

	it('tags done task cards and flags them dimmed', async () => {
		await render()

		const doneCard = Array.from(
			column('Done')?.querySelectorAll('.pipeline__card') ?? [],
		).find(candidate => candidate.textContent?.includes('CSV export'))
		expect(doneCard?.getAttribute('data-done')).toBe('true')
		expect(doneCard?.querySelector('.tag')?.textContent).toBe('done')
		expect(doneCard?.textContent).toContain('✓ done')
	})

	it('launches an agent from a backlog card', async () => {
		await render()

		const launch = Array.from(
			column('Backlog')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).find(button => button.textContent?.includes('Launch agent'))
		await act(async () => {
			launch?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo',
		})
		expect(invokeMock).toHaveBeenCalledWith(
			'tasks_update',
			expect.objectContaining({ id: 'task-backlog' }),
		)
		// v2 drops the cockpit redirect: the board stays visible so the card
		// is seen moving into Running.
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it('keeps a blocked card visible but not launchable', async () => {
		await render()

		const blockedCard = Array.from(
			column('Backlog')?.querySelectorAll('.pipeline__card') ?? [],
		).find(card => card.textContent?.includes('Blocked work'))
		expect(blockedCard?.textContent).toContain('waiting on infra')
		const launch = Array.from(
			blockedCard?.querySelectorAll<HTMLButtonElement>('button') ?? [],
		).find(button => button.textContent?.includes('Launch agent'))
		expect(launch?.disabled).toBe(true)
	})

	it('marks an in-progress task done', async () => {
		await render()

		const done = Array.from(
			column('Running')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).find(button => button.textContent?.includes('Mark done'))
		await act(async () => {
			done?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith(
			'tasks_update',
			expect.objectContaining({ id: 'task-wip', status: 'done' }),
		)
	})

	it('routes session cards: running opens the cockpit, ended opens the review', async () => {
		store.set(startSessionAtom, {
			id: 'run-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(startSessionAtom, {
			id: 'rev-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(endSessionAtom, { sessionId: 'rev-1', exitCode: 0 })
		await render()

		const open = Array.from(
			column('Running')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).find(button => button.textContent?.includes('Open'))
		await act(async () => {
			open?.click()
		})
		expect(navigateMock).toHaveBeenCalledWith('/agent-run/run-1')

		const review = Array.from(
			column('Review')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).find(button => button.textContent?.includes('Review'))
		await act(async () => {
			review?.click()
		})
		expect(navigateMock).toHaveBeenCalledWith('/review')
	})

	it('stops a running session from its card', async () => {
		store.set(startSessionAtom, {
			id: 'run-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const stop = Array.from(
			column('Running')?.querySelectorAll<HTMLButtonElement>('button') ??
				[],
		).find(button => button.textContent?.includes('Stop'))
		await act(async () => {
			stop?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_close', {
			sessionId: 'run-1',
		})
	})

	it('asks for a project when none is active', async () => {
		await render(null)

		expect(container.textContent).toContain('Select a repository')
	})
})
