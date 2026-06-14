import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { sessionsAtom } from './sessions'
import { SplitNew } from './SplitNew'

const store = getDefaultStore()

describe('SplitNew', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
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

	const render = (): void => {
		act(() => {
			root.render(<SplitNew repoPath="/repo" />)
		})
	}

	const mainButton = (): HTMLButtonElement | null =>
		container.querySelector<HTMLButtonElement>('.mz-split-main')

	it('spawns the default shell from the main button, pending meanwhile', async () => {
		let releaseShell: ((shell: string) => void) | undefined
		const shellResolved = new Promise<string>(resolve => {
			releaseShell = resolve
		})
		invokeMock.mockImplementation(command =>
			command === 'session_default_shell'
				? shellResolved
				: Promise.resolve('sess-1'),
		)
		render()

		act(() => {
			mainButton()?.click()
		})

		expect(mainButton()?.textContent).toContain('Opening…')
		expect(mainButton()?.disabled).toBe(true)

		await act(async () => {
			releaseShell?.('/bin/zsh')
		})

		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: '/bin/zsh',
			cwd: '/repo',
		})
		expect(mainButton()?.textContent).toContain('New terminal')
		expect(mainButton()?.disabled).toBe(false)
	})

	it('toggles the agent menu from the chevron', () => {
		render()
		const chevron = container.querySelector<HTMLElement>('.mz-split-chev')
		const menu = container.querySelector('.mz-menu')

		expect(menu?.getAttribute('data-open')).toBe('false')
		expect(chevron?.getAttribute('aria-expanded')).toBe('false')

		act(() => {
			chevron?.click()
		})

		expect(menu?.getAttribute('data-open')).toBe('true')
		expect(chevron?.getAttribute('aria-expanded')).toBe('true')

		act(() => {
			chevron?.click()
		})

		expect(menu?.getAttribute('data-open')).toBe('false')
	})

	it('launches the Claude agent from the menu and closes it', async () => {
		invokeMock.mockResolvedValue('sess-2')
		render()

		act(() => {
			container.querySelector<HTMLElement>('.mz-split-chev')?.click()
		})
		const claude = Array.from(
			container.querySelectorAll<HTMLElement>('.mz-menu-item'),
		).find(item => item.textContent?.includes('Claude'))
		expect(claude?.textContent).toContain('code agent')
		expect(claude?.querySelector('.ag-def')?.textContent).toBe('default')

		await act(async () => {
			claude?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo',
		})
		expect(
			container.querySelector('.mz-menu')?.getAttribute('data-open'),
		).toBe('false')
	})

	it('points plugin authors at the agents directory', () => {
		render()

		expect(container.querySelector('.mz-menu-foot')?.textContent).toContain(
			'~/.mizraj/agents',
		)
	})

	it('closes the menu on an outside mousedown, keeps it on an inside one', () => {
		render()
		const menu = container.querySelector('.mz-menu')

		act(() => {
			container.querySelector<HTMLElement>('.mz-split-chev')?.click()
		})
		act(() => {
			menu?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
		})
		expect(menu?.getAttribute('data-open')).toBe('true')

		act(() => {
			document.body.dispatchEvent(
				new MouseEvent('mousedown', { bubbles: true }),
			)
		})
		expect(menu?.getAttribute('data-open')).toBe('false')
	})

	it('closes the menu on Escape', () => {
		render()

		act(() => {
			container.querySelector<HTMLElement>('.mz-split-chev')?.click()
		})
		act(() => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			)
		})

		expect(
			container.querySelector('.mz-menu')?.getAttribute('data-open'),
		).toBe('false')
	})
})
