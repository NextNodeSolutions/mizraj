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

import { useDiff } from '@/features/diff/useDiff'
import { resetAppFocusForTests } from '@/shared/appFocus'

import { resetRepoEventsForTests } from './repoEvents'

type RepoChangedEvent = {
	payload: { repoPath: string; kind: string }
}

const DiffProbe = ({ repoPath }: { repoPath: string }): React.JSX.Element => {
	const { state } = useDiff(repoPath)
	return <span>{state.status}</span>
}

describe('repo-changed invalidation', () => {
	let container: HTMLDivElement
	let root: Root
	let emitRepoChanged: ((event: RepoChangedEvent) => void) | null

	beforeEach(() => {
		resetRepoEventsForTests()
		resetAppFocusForTests()
		invokeMock.mockReset()
		listenMock.mockReset()
		emitRepoChanged = null
		listenMock.mockImplementation(
			(_event: string, handler: (event: RepoChangedEvent) => void) => {
				emitRepoChanged = handler
				return Promise.resolve(() => {})
			},
		)
		invokeMock.mockResolvedValue({ patch: '' })
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

	const renderProbe = async (repoPath: string): Promise<void> => {
		await act(async () => {
			root.render(<DiffProbe repoPath={repoPath} />)
		})
	}

	it("an event for the hook's repo refetches it", async () => {
		await renderProbe('/repo/alpha')
		const callsBefore = invokeMock.mock.calls.length

		await act(async () => {
			emitRepoChanged?.({
				payload: { repoPath: '/repo/alpha', kind: 'worktree' },
			})
		})

		expect(invokeMock.mock.calls.length).toBe(callsBefore + 1)
		expect(invokeMock).toHaveBeenLastCalledWith('get_diff', {
			repoPath: '/repo/alpha',
		})
	})

	it('an event for another repo does NOT refetch', async () => {
		await renderProbe('/repo/alpha')
		const callsBefore = invokeMock.mock.calls.length

		await act(async () => {
			emitRepoChanged?.({
				payload: { repoPath: '/repo/beta', kind: 'worktree' },
			})
		})

		expect(invokeMock.mock.calls.length).toBe(callsBefore)
	})

	it('stops refetching after the hook unmounts', async () => {
		await renderProbe('/repo/alpha')

		await act(async () => {
			root.unmount()
		})
		const callsBefore = invokeMock.mock.calls.length

		await act(async () => {
			emitRepoChanged?.({
				payload: { repoPath: '/repo/alpha', kind: 'worktree' },
			})
		})

		expect(invokeMock.mock.calls.length).toBe(callsBefore)
	})

	it('registers a single repo-changed listener for many hooks', async () => {
		await act(async () => {
			root.render(
				<>
					<DiffProbe repoPath="/repo/alpha" />
					<DiffProbe repoPath="/repo/alpha" />
				</>,
			)
		})

		expect(listenMock).toHaveBeenCalledTimes(1)
	})

	it('keeps refetching for the survivor after a co-subscriber unmounts', async () => {
		const secondContainer = document.createElement('div')
		document.body.appendChild(secondContainer)
		const secondRoot = createRoot(secondContainer)

		await renderProbe('/repo/alpha')
		await act(async () => {
			secondRoot.render(<DiffProbe repoPath="/repo/alpha" />)
		})

		// Drop one of the two subscribers on /repo/alpha.
		await act(async () => {
			secondRoot.unmount()
		})
		secondContainer.remove()
		const callsBefore = invokeMock.mock.calls.length

		await act(async () => {
			emitRepoChanged?.({
				payload: { repoPath: '/repo/alpha', kind: 'worktree' },
			})
		})

		// The survivor still refetches — losing a co-subscriber didn't tear down
		// the repo's subscription.
		expect(invokeMock.mock.calls.length).toBe(callsBefore + 1)
		expect(invokeMock).toHaveBeenLastCalledWith('get_diff', {
			repoPath: '/repo/alpha',
		})
	})

	it('an event after the last subscriber unmounts is a no-op', async () => {
		await renderProbe('/repo/alpha')

		await act(async () => {
			root.unmount()
		})
		const callsBefore = invokeMock.mock.calls.length

		await act(async () => {
			emitRepoChanged?.({
				payload: { repoPath: '/repo/alpha', kind: 'worktree' },
			})
		})

		expect(invokeMock.mock.calls.length).toBe(callsBefore)
	})
})
