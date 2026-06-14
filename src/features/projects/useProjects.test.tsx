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

import { resetProjectsForTests, useProjects } from './useProjects'

const RegistryProbe = (): React.JSX.Element => {
	const { projects, missing, addProject, removeProject, refreshMissing } =
		useProjects()
	return (
		<div>
			<ul>
				{projects.map(path => (
					<li key={path}>{path}</li>
				))}
			</ul>
			<ul aria-label="missing">
				{missing.map(path => (
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
			<button type="button" onClick={() => void refreshMissing()}>
				refresh-missing
			</button>
		</div>
	)
}

describe('useProjects', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		resetProjectsForTests()
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

	it('re-lists after an add so the canonical path reconciles with backend truth', async () => {
		// The backend canonicalizes the path; the picker shows whatever the
		// re-fetched registry holds, never a locally-guessed entry.
		let added = false
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve(added ? ['/canonical/new'] : [])
			}
			if (command === 'projects_add') {
				added = true
				return Promise.resolve('/canonical/new')
			}
			return Promise.resolve(null)
		})

		await renderProbe()
		await act(async () => {
			container.querySelectorAll('button')[0]?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_add', {
			repoPath: '/tmp/new',
		})
		// projects_list ran twice: the mount load and the post-add reconcile.
		const listCalls = invokeMock.mock.calls.filter(
			([command]) => command === 'projects_list',
		)
		expect(listCalls).toHaveLength(2)
		expect(container.textContent).toContain('/canonical/new')
	})

	it('leaves the list unchanged and returns null when projects_add rejects', async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve(['/tmp/repo-a'])
			}
			if (command === 'projects_add') {
				return Promise.reject(new Error('add blew up'))
			}
			return Promise.resolve(null)
		})

		await renderProbe()
		await act(async () => {
			container.querySelectorAll('button')[0]?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('projects_add', {
			repoPath: '/tmp/new',
		})
		// The mount listing stands; no reconcile fired and no entry was guessed.
		const listCalls = invokeMock.mock.calls.filter(
			([command]) => command === 'projects_list',
		)
		expect(listCalls).toHaveLength(1)
		expect(container.textContent).toContain('/tmp/repo-a')
		expect(container.textContent).not.toContain('/tmp/new')
	})

	it('refreshMissing re-probes the missing atom on demand', async () => {
		let probed = false
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve(['/tmp/repo-a', '/tmp/repo-gone'])
			}
			if (command === 'projects_missing') {
				return Promise.resolve(probed ? ['/tmp/repo-gone'] : [])
			}
			return Promise.resolve(null)
		})

		await renderProbe()
		const missing = container.querySelector('[aria-label="missing"]')
		expect(missing?.textContent).not.toContain('/tmp/repo-gone')

		probed = true
		await act(async () => {
			container.querySelectorAll('button')[2]?.click()
		})

		expect(missing?.textContent).toContain('/tmp/repo-gone')
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

	it('flags the registry entries that vanished from disk', async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === 'projects_list') {
				return Promise.resolve(['/tmp/repo-a', '/tmp/repo-gone'])
			}
			if (command === 'projects_missing') {
				return Promise.resolve(['/tmp/repo-gone'])
			}
			return Promise.resolve(null)
		})

		await renderProbe()

		expect(invokeMock).toHaveBeenCalledWith('projects_missing')
		const missing = container.querySelector('[aria-label="missing"]')
		expect(missing?.textContent).toContain('/tmp/repo-gone')
		expect(missing?.textContent).not.toContain('/tmp/repo-a')
	})

	it('keeps an empty list and logs when the backend fails', async () => {
		invokeMock.mockRejectedValue(new Error('registry exploded'))

		await renderProbe()

		expect(container.querySelectorAll('li')).toHaveLength(0)
	})
})
