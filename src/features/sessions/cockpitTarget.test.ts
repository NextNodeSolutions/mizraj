import { describe, expect, it } from 'vitest'

import { cockpitTargetHref } from './cockpitTarget'
import type { SessionState } from './sessions'

const session = (
	id: string,
	overrides: Partial<SessionState> = {},
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

describe('cockpitTargetHref', () => {
	it('targets the active session when it still exists', () => {
		const sessions = [session('a'), session('b')]

		expect(cockpitTargetHref(sessions, 'b')).toBe('/agent-run/b')
	})

	it('ignores a stale active id and picks the first running session', () => {
		const sessions = [
			session('ended', { status: 'ended', exitCode: 0 }),
			session('live'),
		]

		expect(cockpitTargetHref(sessions, 'gone')).toBe('/agent-run/live')
	})

	it('falls back to the most recently started session', () => {
		const sessions = [
			session('old', { status: 'ended', exitCode: 0, startedAt: 10 }),
			session('new', { status: 'ended', exitCode: 1, startedAt: 20 }),
		]

		expect(cockpitTargetHref(sessions, null)).toBe('/agent-run/new')
	})

	it('lands on the cockpit empty state without any session', () => {
		expect(cockpitTargetHref([], null)).toBe('/agent-run')
	})
})
