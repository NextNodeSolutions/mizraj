import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const PLAN_ENTRIES = [
	{
		kind: 'plan',
		slug: 'auth-hardening',
		title: 'Auth hardening',
		url: 'plan://plan/auth-hardening',
		mtime: 2,
	},
	{
		kind: 'interview',
		slug: 'auth-hardening',
		title: 'Auth hardening — interview',
		url: 'plan://interview/auth-hardening',
		mtime: 1,
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

	it('opens the selected plan document', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		const frame = container.querySelector('iframe')
		expect(frame?.getAttribute('src')).toBe('plan://plan/auth-hardening')
	})

	it('marks the open plan in the list', async () => {
		window.history.pushState({}, '', '/plans/plan/auth-hardening')
		await render()

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.textContent).toBe('Auth hardening')
	})

	it('navigates to a plan from the list', async () => {
		await render()

		const link = Array.from(
			container.querySelectorAll<HTMLAnchorElement>('a'),
		).find(anchor => anchor.textContent === 'Auth hardening')
		await act(async () => {
			link?.click()
		})

		expect(window.location.pathname).toBe('/plans/plan/auth-hardening')
	})
})
