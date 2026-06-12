import { describe, expect, it } from 'vitest'

import { sessionDisplayStatus, DISPLAY_STATUS_LABEL } from './displayStatus'
import type { SessionState } from './sessions'

const session = (overrides: Partial<SessionState>): SessionState => ({
	id: 'sess-a',
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	output: [],
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

describe('sessionDisplayStatus', () => {
	it('maps a running session to running', () => {
		expect(sessionDisplayStatus(session({}))).toBe('running')
	})

	it('maps a clean exit to review — the agent finished, the diff awaits', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: 0 })),
		).toBe('review')
	})

	it('maps a non-zero exit to failed', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: 1 })),
		).toBe('failed')
	})

	it('maps an ended session without exit code to failed', () => {
		expect(
			sessionDisplayStatus(session({ status: 'ended', exitCode: null })),
		).toBe('failed')
	})
})

describe('DISPLAY_STATUS_LABEL', () => {
	it('labels every display status', () => {
		expect(DISPLAY_STATUS_LABEL).toEqual({
			running: 'running',
			review: 'needs review',
			failed: 'failed',
		})
	})
})
