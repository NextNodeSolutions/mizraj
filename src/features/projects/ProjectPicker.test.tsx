import { Provider } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const openDialogMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: openDialogMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { ProjectPicker } from './ProjectPicker'

const REGISTRY = ['/Users/dev/repo-a', '/Users/dev/repo-b']

const press = async (key: string): Promise<void> => {
	await act(async () => {
		window.dispatchEvent(new KeyboardEvent('keydown', { key }))
	})
}

describe('ProjectPicker', () => {
	let container: HTMLDivElement
	let root: Root
	let onSelect: ReturnType<typeof vi.fn<(path: string) => void>>

	beforeEach(() => {
		invokeMock.mockReset()
		openDialogMock.mockReset()
		onSelect = vi.fn<(path: string) => void>()
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') return Promise.resolve(REGISTRY)
			if (command === 'projects_missing') return Promise.resolve([])
			return Promise.resolve(null)
		})
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

	const renderPicker = async (active: string | null): Promise<void> => {
		await act(async () => {
			root.render(
				<Provider>
					<ProjectPicker
						activeProjectPath={active}
						onSelect={onSelect}
					/>
				</Provider>,
			)
		})
	}

	const trigger = (): HTMLButtonElement => {
		const button = container.querySelector<HTMLButtonElement>('.mz-proj')
		if (!button) throw new Error('picker trigger not found')
		return button
	}

	const openMenu = async (): Promise<void> => {
		await act(async () => {
			trigger().click()
		})
	}

	const menuOptions = (): HTMLElement[] =>
		Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))

	it('opens a menu listing the registry with the active repo marked', async () => {
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		const options = menuOptions()
		expect(options.map(option => option.textContent)).toEqual([
			expect.stringContaining('repo-a'),
			expect.stringContaining('repo-b'),
			expect.stringContaining('Add repo…'),
		])
		expect(options[0]?.getAttribute('aria-selected')).toBe('true')
	})

	it('selecting a repo switches to it and closes the menu', async () => {
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		await act(async () => {
			menuOptions()[1]?.click()
		})

		expect(onSelect).toHaveBeenCalledWith('/Users/dev/repo-b')
		expect(menuOptions()).toHaveLength(0)
	})

	it('Add repo… registers the chosen directory and switches to it', async () => {
		openDialogMock.mockResolvedValue('/Users/dev/fresh')
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') return Promise.resolve(REGISTRY)
			if (command === 'projects_missing') return Promise.resolve([])
			if (command === 'projects_add') {
				return Promise.resolve('/Users/dev/fresh')
			}
			return Promise.resolve(null)
		})
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		await act(async () => {
			menuOptions().at(-1)?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_add', {
			repoPath: '/Users/dev/fresh',
		})
		expect(onSelect).toHaveBeenCalledWith('/Users/dev/fresh')
	})

	it('supports arrow keys, Enter and Escape', async () => {
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		await press('ArrowDown')
		await press('Enter')
		expect(onSelect).toHaveBeenCalledWith('/Users/dev/repo-b')

		await openMenu()
		await press('Escape')
		expect(menuOptions()).toHaveLength(0)
	})

	it('groups vanished repos under "introuvable" and strikes them through', async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve([
					'/Users/dev/repo-a',
					'/Users/dev/repo-gone',
				])
			}
			if (command === 'projects_missing') {
				return Promise.resolve(['/Users/dev/repo-gone'])
			}
			return Promise.resolve(null)
		})
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		expect(container.querySelector('.pal-group')?.textContent).toBe(
			'introuvable',
		)
		const gone = menuOptions().find(
			option => option.getAttribute('data-missing') === 'true',
		)
		expect(gone?.textContent).toContain('repo-gone')
	})

	it('the remove button prunes a repo from the pool without switching', async () => {
		await renderPicker('/Users/dev/repo-a')
		await openMenu()

		const repoB = menuOptions()[1]
		const remove = repoB?.querySelector<HTMLButtonElement>('.pal-rm')
		await act(async () => {
			remove?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_remove', {
			repoPath: '/Users/dev/repo-b',
		})
		expect(onSelect).not.toHaveBeenCalled()
	})
})
