import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
	reviewHref: () => '/review',
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

const pushToastMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/toasts', () => ({
	pushToast: pushToastMock,
}))

vi.mock('./SplitTreeView', () => ({
	SplitTreeView: ({ rootId }: { rootId: string }) => (
		<div data-testid="terminal-stub" data-root={rootId} />
	),
}))

import { AgentRun } from './AgentRun'
import { endSessionAtom, sessionsAtom, startSessionAtom } from './sessions'

const store = getDefaultStore()

describe('AgentRun cockpit', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
		invokeMock.mockResolvedValue({ patch: '' })
		navigateMock.mockReset()
		pushToastMock.mockReset()
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

	const seed = (id: string, ended?: { exitCode: number }): void => {
		store.set(startSessionAtom, {
			id,
			binary: 'claude',
			repoPath: '/repo/mizraj',
		})
		if (ended) {
			store.set(endSessionAtom, {
				sessionId: id,
				exitCode: ended.exitCode,
			})
		}
	}

	const render = async (
		sessionId: string,
		activeProjectPath: string | null = null,
	): Promise<void> => {
		await act(async () => {
			root.render(
				<AgentRun
					sessionId={sessionId}
					activeProjectPath={activeProjectPath}
				/>,
			)
		})
	}

	const mockRepoHead = (branch: string): void => {
		invokeMock.mockImplementation((command: string) =>
			command === 'repo_head'
				? Promise.resolve({ branch, detached: false })
				: Promise.resolve({ patch: '' }),
		)
	}

	it('lays out sessions, terminal and docked diffs', async () => {
		seed('sess-1')
		await render('sess-1')

		const wrap = container.querySelector('.fc-wrap.stagger')
		expect(wrap).not.toBeNull()
		expect(wrap?.querySelector('.fc-sess')).not.toBeNull()
		expect(
			wrap
				?.querySelector('.term.fc-term .fc-term-body')
				?.querySelector('[data-testid="terminal-stub"]')
				?.getAttribute('data-root'),
		).toBe('sess-1')
		expect(wrap?.querySelector('.diff-panel')).not.toBeNull()
	})

	it('labels the terminal tab with the active repo branch and status dot', async () => {
		mockRepoHead('feat/login')
		seed('sess-1')
		await render('sess-1')

		const tab = container.querySelector('.fc-term-tab')
		expect(tab?.textContent).toContain('feat/login')
		expect(tab?.querySelector('.sdot')?.className).toBe('sdot sdot-run')
	})

	it('falls back to the session label while the branch is unknown', async () => {
		seed('sess-1')
		await render('sess-1')

		expect(container.querySelector('.fc-term-tab')?.textContent).toContain(
			'claude',
		)
	})

	it('shows the engine and binary context label', async () => {
		store.set(startSessionAtom, {
			id: 'sess-1',
			binary: '/usr/local/bin/claude',
			repoPath: '/repo/mizraj',
		})
		await render('sess-1')

		expect(container.querySelector('.fc-cwd')?.textContent).toBe(
			'ghostty · claude',
		)
	})

	it('stops the session from the tab bar and confirms with a toast', async () => {
		seed('sess-1')
		await render('sess-1')

		const stop = container.querySelector<HTMLButtonElement>(
			'.fc-term-bar button.btn.btn-sm.btn-ghost',
		)
		expect(stop?.textContent).toContain('Stop')
		await act(async () => {
			stop?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_close', {
			sessionId: 'sess-1',
		})
		expect(pushToastMock).toHaveBeenCalledWith('Session stopped')
	})

	it('disables stop and shows the exit code once ended', async () => {
		seed('sess-1', { exitCode: 3 })
		await render('sess-1')

		const stop = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Stop'))
		expect(stop?.disabled).toBe(true)
		expect(container.querySelector('.fc-term-exit')?.textContent).toBe(
			'exit 3',
		)
	})

	it('opens the full review from the diff dock', async () => {
		seed('sess-1')
		await render('sess-1')

		const openReview = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Open review'))
		act(() => {
			openReview?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/review')
	})
})
