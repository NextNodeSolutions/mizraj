import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'

import { pickAgentSession } from './pickAgentSession'

const session = (overrides: Partial<SessionState>): SessionState => ({
	id: 'sess',
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

describe('pickAgentSession', () => {
	it('picks the most recent running agent in the repo', () => {
		const picked = pickAgentSession(
			[
				session({ id: 'old', startedAt: 1 }),
				session({ id: 'new', startedAt: 2 }),
			],
			'/repo',
		)

		expect(picked?.id).toBe('new')
	})

	it('prefers an agent binary over a plain shell', () => {
		const picked = pickAgentSession(
			[
				session({ id: 'shell', binary: '/bin/zsh', startedAt: 9 }),
				session({ id: 'agent', binary: 'claude', startedAt: 1 }),
			],
			'/repo',
		)

		expect(picked?.id).toBe('agent')
	})

	it('falls back to a running shell when no agent lives', () => {
		const picked = pickAgentSession(
			[session({ id: 'shell', binary: '/bin/zsh' })],
			'/repo',
		)

		expect(picked?.id).toBe('shell')
	})

	it('ignores ended sessions and other repos', () => {
		const picked = pickAgentSession(
			[
				session({ id: 'done', status: 'ended', exitCode: 0 }),
				session({ id: 'elsewhere', repoPath: '/other' }),
			],
			'/repo',
		)

		expect(picked).toBeNull()
	})

	it('returns null without a repo', () => {
		expect(pickAgentSession([session({})], null)).toBeNull()
	})
})
