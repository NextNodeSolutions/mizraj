import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	listenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock,
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

import { useOverviews } from './useOverviews'

const emptyOverview = { milestones: [], userTasks: [] }

const userTaskOverview = (title: string): unknown => ({
	milestones: [],
	userTasks: [
		{
			id: `task-${title}`,
			identifier: null,
			origin: 'user',
			milestoneId: null,
			trackId: null,
			step: null,
			title,
			description: null,
			doneWhen: null,
			size: null,
			sliceOf: [],
			sinkId: null,
			position: 0,
			status: 'backlog',
			blockedReason: null,
			commitSha: null,
			createdAt: '2026-01-01T00:00:00Z',
		},
	],
})

const Probe = ({
	repos,
}: {
	repos: ReadonlyArray<string>
}): React.JSX.Element => {
	const { overviews } = useOverviews(repos)
	return (
		<ul>
			{overviews.flatMap(overview =>
				overview.userTasks.map(task => (
					<li key={task.id}>
						{task.title}:{task.repoPath}
					</li>
				)),
			)}
		</ul>
	)
}

describe('useOverviews', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockReset()
		listenMock.mockReset()
		listenMock.mockResolvedValue(() => {})
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

	it('loads and tags the overview of every repo', async () => {
		invokeMock.mockImplementation(
			(_command: string, args?: { repoPath?: string }) =>
				Promise.resolve(
					args?.repoPath === '/repo/alpha'
						? userTaskOverview('alpha work')
						: userTaskOverview('beta work'),
				),
		)

		await act(async () => {
			root.render(<Probe repos={['/repo/alpha', '/repo/beta']} />)
		})

		expect(container.textContent).toContain('alpha work:/repo/alpha')
		expect(container.textContent).toContain('beta work:/repo/beta')
	})

	it('skips a failing repo and keeps the others', async () => {
		invokeMock.mockImplementation(
			(_command: string, args?: { repoPath?: string }) =>
				args?.repoPath === '/repo/broken'
					? Promise.reject(new Error('no db'))
					: Promise.resolve(userTaskOverview('alive')),
		)

		await act(async () => {
			root.render(<Probe repos={['/repo/broken', '/repo/ok']} />)
		})

		expect(container.textContent).toContain('alive:/repo/ok')
		expect(container.textContent).not.toContain('broken')
	})

	it('renders nothing for an empty registry', async () => {
		invokeMock.mockResolvedValue(emptyOverview)

		await act(async () => {
			root.render(<Probe repos={[]} />)
		})

		expect(container.querySelectorAll('li')).toHaveLength(0)
		expect(invokeMock).not.toHaveBeenCalled()
	})
})
