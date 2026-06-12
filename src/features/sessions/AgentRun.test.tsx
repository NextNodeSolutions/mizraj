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

	const render = (sessionId: string): void => {
		act(() => {
			root.render(<AgentRun sessionId={sessionId} />)
		})
	}

	it('lays out sessions, terminal and docked diffs', () => {
		seed('sess-1')
		render('sess-1')

		expect(container.querySelector('.cockpit-sessions')).not.toBeNull()
		expect(
			container
				.querySelector('[data-testid="terminal-stub"]')
				?.getAttribute('data-root'),
		).toBe('sess-1')
		expect(container.querySelector('.diff-panel')).not.toBeNull()
	})

	it('labels the terminal tab with the session and its status', () => {
		seed('sess-1')
		render('sess-1')

		const tab = container.querySelector('.cockpit__tab')
		expect(tab?.textContent).toContain('claude')
		expect(
			tab?.querySelector('.status-dot')?.getAttribute('data-status'),
		).toBe('running')
	})

	it('stops the session from the tab bar', () => {
		seed('sess-1')
		render('sess-1')

		const stop = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Stop'))
		act(() => {
			stop?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_close', {
			sessionId: 'sess-1',
		})
	})

	it('disables stop and shows the exit code once ended', () => {
		seed('sess-1', { exitCode: 3 })
		render('sess-1')

		const stop = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Stop'))
		expect(stop?.disabled).toBe(true)
		expect(container.querySelector('.cockpit__exit')?.textContent).toBe(
			'exit 3',
		)
	})

	it('opens the full review from the diff dock', () => {
		seed('sess-1')
		render('sess-1')

		const openReview = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Open review'))
		act(() => {
			openReview?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/review')
	})
})
