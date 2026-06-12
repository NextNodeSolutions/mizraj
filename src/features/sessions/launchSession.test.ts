import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	agentRunHref: (sessionId: string) => `/run/${sessionId}`,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { logger } from '@/shared/logger'

import { launchSession, launchShellSession } from './launchSession'
import { sessionsAtom } from './sessions'

const store = getDefaultStore()

describe('launchSession', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
		navigateMock.mockReset()
		vi.mocked(logger.error).mockReset()
	})

	it('spawns, registers and navigates to the new session', async () => {
		invokeMock.mockResolvedValue('sess-9')

		const launched = await launchSession({
			binary: 'claude',
			repoPath: '/repo',
		})

		expect(launched).toBe(true)
		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: 'claude',
			cwd: '/repo',
		})
		expect(store.get(sessionsAtom)['sess-9']?.binary).toBe('claude')
		expect(navigateMock).toHaveBeenCalledWith('/run/sess-9')
	})

	it('reports failure without navigating', async () => {
		invokeMock.mockRejectedValue(new Error('spawn failed'))

		const launched = await launchSession({
			binary: 'claude',
			repoPath: '/repo',
		})

		expect(launched).toBe(false)
		expect(navigateMock).not.toHaveBeenCalled()
		expect(logger.error).toHaveBeenCalledTimes(1)
	})
})

describe('launchShellSession', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
		invokeMock.mockReset()
		navigateMock.mockReset()
	})

	it('spawns the default shell reported by the backend', async () => {
		invokeMock.mockImplementation(command =>
			command === 'session_default_shell'
				? Promise.resolve('/bin/fish')
				: Promise.resolve('sess-7'),
		)

		const launched = await launchShellSession('/repo')

		expect(launched).toBe(true)
		expect(invokeMock).toHaveBeenCalledWith('session_create', {
			binary: '/bin/fish',
			cwd: '/repo',
		})
		expect(store.get(sessionsAtom)['sess-7']?.binary).toBe('/bin/fish')
	})
})
