import { describe, expect, it } from 'vitest'

import { sessionLabel, sessionRepoLabel } from './sessionLabel'
import type { SessionState } from './sessions'

const session = (overrides: Partial<SessionState>): SessionState => ({
	id: 'sess-a',
	binary: '/bin/zsh',
	repoPath: '/Users/me/dev/mizraj',
	title: null,
	output: [],
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

describe('sessionLabel', () => {
	it('prefers the program-set title', () => {
		expect(sessionLabel(session({ title: 'Refactor auth' }))).toBe(
			'Refactor auth',
		)
	})

	it('falls back to the binary name without its path', () => {
		expect(sessionLabel(session({}))).toBe('zsh')
	})

	it('falls back to the session id when the binary is blank', () => {
		expect(sessionLabel(session({ binary: '' }))).toBe('sess-a')
	})
})

describe('sessionRepoLabel', () => {
	it('returns the repo directory name', () => {
		expect(sessionRepoLabel(session({}))).toBe('mizraj')
	})

	it('returns null without a repo', () => {
		expect(sessionRepoLabel(session({ repoPath: null }))).toBeNull()
	})
})
