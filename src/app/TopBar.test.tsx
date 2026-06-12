import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { TopBar } from './TopBar'

describe('TopBar', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
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

	const render = (
		props: Partial<Parameters<typeof TopBar>[0]> = {},
	): void => {
		act(() => {
			root.render(
				<TopBar
					activeProjectPath="/Users/me/dev/mizraj"
					onSelectProject={() => {}}
					onOpenSettings={() => {}}
					{...props}
				/>,
			)
		})
	}

	it('brands the app and navigates home on click', () => {
		window.history.pushState({}, '', '/tasks')
		render()

		const brand = container.querySelector<HTMLElement>('.top-bar__brand')
		expect(brand?.textContent).toContain('Mizraj')
		act(() => {
			brand?.click()
		})

		expect(window.location.pathname).toBe('/')
	})

	it('marks the current screen in the nav', () => {
		render()

		const current = container.querySelector('[aria-current="page"]')
		expect(current?.textContent).toBe('Mission Control')
	})

	it('navigates to tasks from the nav', () => {
		render()

		const tasks = Array.from(
			container.querySelectorAll<HTMLElement>('.top-bar__nav-link'),
		).find(link => link.textContent === 'Tasks')
		act(() => {
			tasks?.click()
		})

		expect(window.location.pathname).toBe('/tasks')
	})

	it('shows the active repo name on the project pill', () => {
		render()

		expect(
			container.querySelector('.project-picker')?.textContent,
		).toContain('mizraj')
	})

	it('offers agent and terminal launchers only with a project', () => {
		render({ activeProjectPath: null })

		expect(container.querySelector('.run-agent-button')).toBeNull()

		render()
		expect(container.querySelector('.run-agent-button')).not.toBeNull()
	})

	it('opens settings through its trigger', () => {
		const onOpenSettings = vi.fn()
		render({ onOpenSettings })

		act(() => {
			container
				.querySelector<HTMLElement>('.settings-trigger')
				?.click()
		})

		expect(onOpenSettings).toHaveBeenCalledTimes(1)
	})
})
