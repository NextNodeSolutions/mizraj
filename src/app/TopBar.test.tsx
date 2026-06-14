import { getDefaultStore } from 'jotai'
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

import { paletteOpenAtom } from '@/features/palette/palette'
import { sessionsAtom } from '@/features/sessions/sessions'

import { TopBar } from './TopBar'

const store = getDefaultStore()

describe('TopBar', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(paletteOpenAtom, false)
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

		const brand = container.querySelector<HTMLElement>('.mz-brand')
		expect(brand?.textContent).toContain('Mizraj')
		act(() => {
			brand?.click()
		})

		expect(window.location.pathname).toBe('/')
	})

	it('scopes mission control to all projects on the repo button', () => {
		render()

		const scope = container.querySelector('.mz-proj')
		expect(scope?.textContent).toContain('scope')
		expect(scope?.textContent).toContain('all projects')
	})

	it('names the active repo on every other route', () => {
		window.history.pushState({}, '', '/plans')
		render()

		const scope = container.querySelector('.mz-proj')
		expect(scope?.textContent).toContain('repo')
		expect(scope?.querySelector('b')?.textContent).toBe('mizraj')
	})

	it('invites choosing a repo when none is active', () => {
		render({ activeProjectPath: null })

		expect(container.querySelector('.mz-proj')?.textContent).toBe(
			'Choose repo',
		)
	})

	it('summons the palette from the jump button', () => {
		render()

		act(() => {
			container.querySelector<HTMLElement>('.mz-cmdk')?.click()
		})

		expect(store.get(paletteOpenAtom)).toBe(true)
	})

	it('counts sessions in the status cluster', () => {
		render()

		expect(container.querySelector('.mz-status')).not.toBeNull()
	})

	it('offers the split launcher only with a project', () => {
		render({ activeProjectPath: null })
		expect(container.querySelector('.mz-split-wrap')).toBeNull()

		render()
		expect(container.querySelector('.mz-split-wrap')).not.toBeNull()
	})

	it('opens settings through the gear', () => {
		const onOpenSettings = vi.fn()
		render({ onOpenSettings })

		act(() => {
			container
				.querySelector<HTMLElement>(
					'.mz-iconbtn[aria-label="Settings"]',
				)
				?.click()
		})

		expect(onOpenSettings).toHaveBeenCalledTimes(1)
	})
})
