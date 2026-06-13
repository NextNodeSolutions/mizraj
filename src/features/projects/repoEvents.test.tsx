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
	let unlisten: ReturnType<typeof vi.fn>

	beforeEach(() => {
		invokeMock.mockReset()
		listenMock.mockReset()
		emitRepoChanged = null
		unlisten = vi.fn()
		listenMock.mockImplementation(
			(_event: string, handler: (event: RepoChangedEvent) => void) => {
				emitRepoChanged = handler
				return Promise.resolve(unlisten)
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

	it('unsubscribes from the event on unmount', async () => {
		await renderProbe('/repo/alpha')

		await act(async () => {
			root.unmount()
		})

		expect(unlisten).toHaveBeenCalled()
	})
})
