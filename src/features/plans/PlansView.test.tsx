import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toastsAtom } from '@/shared/toasts'

const invokeMock = vi.hoisted(() => vi.fn())

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

import { PlansView } from './PlansView'

const SECONDS_PER_HOUR = 3600
const nowSeconds = Math.floor(Date.now() / 1000)

const EMPTY_OVERVIEW = { milestones: [], userTasks: [] }

const OVERVIEW = {
	milestones: [
		{
			id: 'm1',
			number: 1,
			demo: 'Login works',
			skeleton: false,
			needs: [],
			tracks: [
				{
					id: 'track-a',
					branch: 'feat/track-a',
					tasks: [{ status: 'done' }, { status: 'in_progress' }],
				},
				{
					id: 'track-b',
					branch: 'feat/track-b',
					tasks: [{ status: 'done' }],
				},
			],
		},
	],
	userTasks: [],
}

const PLAN_ENTRIES = [
	{
		kind: 'plan',
		slug: 'auth-hardening',
		title: 'Auth hardening',
		url: 'plan://plan/auth-hardening',
		mtime: nowSeconds - 2 * SECONDS_PER_HOUR,
	},
	{
		kind: 'interview',
		slug: 'auth-hardening',
		title: 'Auth hardening — interview',
		url: 'plan://interview/auth-hardening',
		mtime: nowSeconds - 1 * SECONDS_PER_HOUR,
	},
]

describe('PlansView', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockReset()
		invokeMock.mockImplementation((command: string) => {
			if (command === 'list_plans') return Promise.resolve(PLAN_ENTRIES)
			if (command === 'resolve_plan')
				return Promise.resolve({ url: 'plan://plan/auth-hardening' })
			if (command === 'tasks_overview')
				return Promise.resolve(EMPTY_OVERVIEW)
			return Promise.resolve(undefined)
		})
		window.history.pushState({}, '', '/plans')
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
			root.render(<PlansView activeProjectPath="/repo" />)
		})
	}

	it('lists plans and interviews beside a selection hint', async () => {
		await render()

		expect(container.textContent).toContain('Auth hardening')
		expect(container.textContent).toContain('interview')
		expect(container.textContent).toContain('Select a plan')
	})

	it('lists plan documents before interviews', async () => {
		await render()

		const firstRow = container.querySelector('a')
		expect(firstRow?.getAttribute('href')).toBe(
			'/plans/plan/auth-hardening',
		)
	})

	it('toasts that new interviews come from the agent workflow', async () => {
		await render()

		const button = container.querySelector<HTMLButtonElement>(
			'button[aria-label="New interview"]',
		)
		await act(async () => {
			button?.click()
		})

		const messages = getDefaultStore()
			.get(toastsAtom)
			.map(toast => toast.message)
		expect(messages).toContain(
			'New interview — Claude asks, you answer, a plan comes out',
		)
	})

	it('shows how long ago each entry was updated', async () => {
		await render()

		const planRow = container.querySelector(
			'a[href="/plans/plan/auth-hardening"]',
		)
		expect(planRow?.textContent).toContain('updated 2h ago')
	})

	it('opens the selected plan document', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		const frame = container.querySelector('iframe')
		expect(frame?.getAttribute('src')).toBe('plan://plan/auth-hardening')
	})

	it('crowns the open document with its title and kind tag', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		expect(container.querySelector('h1')?.textContent).toBe(
			'Auth hardening',
		)
		expect(container.querySelector('.pl-doc-head .tag')?.textContent).toBe(
			'plan',
		)
	})

	it('describes the open plan in the meta line', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		expect(container.querySelector('.pl-doc-meta')?.textContent).toContain(
			'auth-hardening · updated 2h ago',
		)
	})

	const serveOverview = (): void => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'list_plans') return Promise.resolve(PLAN_ENTRIES)
			if (command === 'resolve_plan')
				return Promise.resolve({ url: 'plan://plan/auth-hardening' })
			if (command === 'tasks_overview') return Promise.resolve(OVERVIEW)
			return Promise.resolve(undefined)
		})
	}

	it('derives milestone and track states under a plan doc', async () => {
		serveOverview()
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		expect(container.textContent).toContain('Milestones')
		expect(container.textContent).toContain('M1 · Login works')
		expect(container.textContent).toContain('in progress')
		expect(container.textContent).toContain('feat/track-a')

		const trackChecks = container.querySelectorAll('.pl-track .pl-check')
		expect(trackChecks[0]?.getAttribute('data-done')).toBe('false')
		expect(trackChecks[1]?.getAttribute('data-done')).toBe('true')
	})

	it('counts the overview in the plan meta line', async () => {
		serveOverview()
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		expect(container.querySelector('.pl-doc-meta')?.textContent).toContain(
			'· 1 milestones · 2 tracks',
		)
	})

	it('omits the milestones section when none are ingested', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		expect(container.textContent).not.toContain('Milestones')
	})

	it('marks the open plan in the list', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.getAttribute('href')).toBe('/plans/plan/auth-hardening')
		expect(current?.textContent).toContain('Auth hardening')
	})

	it('navigates to a plan from the list', async () => {
		await render()

		const link = container.querySelector<HTMLAnchorElement>(
			'a[href="/plans/plan/auth-hardening"]',
		)
		await act(async () => {
			link?.click()
		})

		expect(window.location.pathname).toBe('/plans/plan/auth-hardening')
	})
})
