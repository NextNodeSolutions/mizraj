import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock, writeTextMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
	writeTextMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
	readText: vi.fn(),
	writeText: writeTextMock,
}))

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/agent-run/${sessionId}`,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { sessionsAtom } from '@/features/sessions/sessions'
import type { Task } from '@/features/tasks/tasks'

import { launchTaskAgent, taskPrompt } from './launchTaskAgent'

const store = getDefaultStore()

const TASK: Task = {
	repoPath: '/repo/x',
	id: 'task-1',
	identifier: 'T1',
	origin: 'track',
	milestoneId: 'm1',
	trackId: 't1',
	step: null,
	title: 'Add rate limiting to API',
	description: 'Token bucket per route.',
	doneWhen: 'limits enforced on /send',
	size: 'M',
	sliceOf: [],
	sinkId: null,
	position: 0,
	status: 'backlog',
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
}

describe('taskPrompt', () => {
	it('assembles title, description and done-when', () => {
		expect(taskPrompt(TASK)).toBe(
			'Add rate limiting to API\n\nToken bucket per route.\n\nDone when: limits enforced on /send',
		)
	})

	it('falls back to the title alone', () => {
		expect(taskPrompt({ ...TASK, description: null, doneWhen: null })).toBe(
			'Add rate limiting to API',
		)
	})
})

describe('launchTaskAgent', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
		navigateMock.mockReset()
		writeTextMock.mockReset()
		writeTextMock.mockResolvedValue(undefined)
	})

	it('spawns the agent, flags the task in progress, arms the prompt and stays on the board', async () => {
		invokeMock.mockImplementation((command: string) =>
			command === 'session_create'
				? Promise.resolve('sess-9')
				: Promise.resolve({ ...TASK, status: 'in_progress' }),
		)

		const sessionId = await launchTaskAgent(TASK)

		expect(sessionId).toBe('sess-9')
		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo/x',
		})
		expect(invokeMock).toHaveBeenCalledWith('tasks_update', {
			repoPath: '/repo/x',
			id: 'task-1',
			title: TASK.title,
			description: TASK.description,
			status: 'in_progress',
		})
		expect(writeTextMock).toHaveBeenCalledWith(taskPrompt(TASK))
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it('aborts without flagging the task when the spawn fails', async () => {
		invokeMock.mockRejectedValue(new Error('no claude on PATH'))

		const sessionId = await launchTaskAgent(TASK)

		expect(sessionId).toBe(null)
		expect(invokeMock).not.toHaveBeenCalledWith(
			'tasks_update',
			expect.anything(),
		)
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it('still succeeds when the spawn lands but the task update fails', async () => {
		// The agent is the real side effect: once it spawned, the launch is a
		// success even if the post-spawn task flag rejects. The session id must
		// still come back, and because launchTaskAgent swallows the update
		// rejection internally this await resolves rather than rejecting — a
		// leaked rejection would surface here as a failing (rejected) test.
		invokeMock.mockImplementation((command: string) =>
			command === 'session_create'
				? Promise.resolve('sess-9')
				: Promise.reject(new Error('db locked')),
		)

		const sessionId = await launchTaskAgent(TASK)

		expect(sessionId).toBe('sess-9')
		expect(invokeMock).toHaveBeenCalledWith(
			'tasks_update',
			expect.objectContaining({ id: 'task-1' }),
		)
	})
})
