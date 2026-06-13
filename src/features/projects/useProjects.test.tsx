import { Provider } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

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

import { useProjects } from './useProjects'

const RegistryProbe = (): React.JSX.Element => {
	const { projects, addProject, removeProject } = useProjects()
	return (
		<div>
			<ul>
				{projects.map(path => (
					<li key={path}>{path}</li>
				))}
			</ul>
			<button type="button" onClick={() => void addProject('/tmp/new')}>
				add
			</button>
			<button
				type="button"
				onClick={() => void removeProject('/tmp/repo-a')}
			>
				remove
			</button>
		</div>
	)
}

describe('useProjects', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockReset()
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

	const renderProbe = async (): Promise<void> => {
		await act(async () => {
			root.render(
				<Provider>
					<RegistryProbe />
				</Provider>,
			)
		})
	}

	it('lists the registry on mount', async () => {
		invokeMock.mockResolvedValue(['/tmp/repo-a', '/tmp/repo-b'])

		await renderProbe()

		expect(invokeMock).toHaveBeenCalledWith('projects_list')
		expect(container.textContent).toContain('/tmp/repo-a')
		expect(container.textContent).toContain('/tmp/repo-b')
	})

	it('reflects an added project without a reload', async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') return Promise.resolve([])
			return Promise.resolve('/tmp/new')
		})

		await renderProbe()
		await act(async () => {
			container.querySelectorAll('button')[0]?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_add', {
			repoPath: '/tmp/new',
		})
		expect(container.textContent).toContain('/tmp/new')
	})

	it('drops a removed project from the list', async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve(['/tmp/repo-a'])
			}
			return Promise.resolve(null)
		})

		await renderProbe()
		await act(async () => {
			container.querySelectorAll('button')[1]?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_remove', {
			repoPath: '/tmp/repo-a',
		})
		expect(container.textContent).not.toContain('/tmp/repo-a')
	})

	it('keeps an empty list and logs when the backend fails', async () => {
		invokeMock.mockRejectedValue(new Error('registry exploded'))

		await renderProbe()

		expect(container.querySelectorAll('li')).toHaveLength(0)
	})
})
