import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as RouterModule from '@/app/router'
import type * as SettingsModule from '@/features/settings/settings'

const { navigateMock, setLastProjectPathMock } = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	setLastProjectPathMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/router', async importOriginal => ({
	...(await importOriginal<typeof RouterModule>()),
	navigate: navigateMock,
}))

vi.mock('@/features/settings/settings', async importOriginal => ({
	...(await importOriginal<typeof SettingsModule>()),
	setLastProjectPath: setLastProjectPathMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { openSession, openSessionReview } from './openSession'

describe('openSession', () => {
	beforeEach(() => {
		navigateMock.mockReset()
		setLastProjectPathMock.mockClear()
	})

	it('retargets the project preference to the session repo, then opens the cockpit', () => {
		openSession({ id: 's1', repoPath: '/repo/beta' })

		expect(setLastProjectPathMock).toHaveBeenCalledWith('/repo/beta')
		expect(navigateMock).toHaveBeenCalledWith('/agent-run/s1')
	})

	it('a repo-less session still opens its cockpit, preference untouched', () => {
		openSession({ id: 's2', repoPath: null })

		expect(setLastProjectPathMock).not.toHaveBeenCalled()
		expect(navigateMock).toHaveBeenCalledWith('/agent-run/s2')
	})

	it('openSessionReview retargets then routes to the review screen', () => {
		openSessionReview({ id: 's3', repoPath: '/repo/gamma' })

		expect(setLastProjectPathMock).toHaveBeenCalledWith('/repo/gamma')
		expect(navigateMock).toHaveBeenCalledWith('/review')
	})
})
