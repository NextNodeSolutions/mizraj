import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'

import {
	HUES,
	compactPath,
	groupSessionsByRepo,
	orderProjectGroups,
	projectHue,
	projectName,
} from './projectGroups'

const session = (
	id: string,
	overrides: Partial<Omit<SessionState, 'id'>> = {},
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/Users/me/dev/mizraj',
	title: null,
	output: [],
	status: 'running',
	exitCode: null,
	startedAt: 1_000,
	...overrides,
})

describe('groupSessionsByRepo', () => {
	it('groups sessions by repo, in first-seen order', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
			session('b', { repoPath: '/repo/y' }),
			session('c', { repoPath: '/repo/x' }),
		])

		expect(groups.map(group => group.repoPath)).toEqual([
			'/repo/x',
			'/repo/y',
		])
		expect(groups[0]?.sessions.map(s => s.id)).toEqual(['a', 'c'])
		expect(groups[1]?.sessions.map(s => s.id)).toEqual(['b'])
	})

	it('collects repo-less sessions into one trailing group', () => {
		const groups = groupSessionsByRepo([
			session('loose-1', { repoPath: null }),
			session('a', { repoPath: '/repo/x' }),
			session('loose-2', { repoPath: null }),
		])

		expect(groups.map(group => group.repoPath)).toEqual(['/repo/x', null])
		expect(groups[1]?.sessions.map(s => s.id)).toEqual([
			'loose-1',
			'loose-2',
		])
	})

	it('orders sessions inside a group: running first, then youngest', () => {
		const groups = groupSessionsByRepo([
			session('old-review', {
				status: 'ended',
				exitCode: 0,
				startedAt: 500,
			}),
			session('old-run', { startedAt: 100 }),
			session('new-run', { startedAt: 900 }),
			session('failed', { status: 'ended', exitCode: 1, startedAt: 800 }),
		])

		expect(groups[0]?.sessions.map(s => s.id)).toEqual([
			'new-run',
			'old-run',
			'old-review',
			'failed',
		])
	})
})

describe('orderProjectGroups', () => {
	it('puts the active project first, the rest by latest start, repo-less last', () => {
		const groups = groupSessionsByRepo([
			session('loose', { repoPath: null, startedAt: 9_999 }),
			session('quiet', { repoPath: '/repo/quiet', startedAt: 100 }),
			session('busy', { repoPath: '/repo/busy', startedAt: 900 }),
			session('active', { repoPath: '/repo/active', startedAt: 50 }),
		])

		const ordered = orderProjectGroups(groups, '/repo/active')

		expect(ordered.map(group => group.repoPath)).toEqual([
			'/repo/active',
			'/repo/busy',
			'/repo/quiet',
			null,
		])
	})

	it('keeps the latest-start order when no project is active', () => {
		const groups = groupSessionsByRepo([
			session('quiet', { repoPath: '/repo/quiet', startedAt: 100 }),
			session('busy', { repoPath: '/repo/busy', startedAt: 900 }),
		])

		expect(
			orderProjectGroups(groups, null).map(group => group.repoPath),
		).toEqual(['/repo/busy', '/repo/quiet'])
	})
})

describe('projectName', () => {
	it('labels a repo by its directory name, the repo-less bucket by "no project"', () => {
		expect(projectName('/Users/me/dev/mizraj')).toBe('mizraj')
		expect(projectName('/srv/api/')).toBe('api')
		expect(projectName(null)).toBe('no project')
	})
})

describe('compactPath', () => {
	it('folds the macOS or Linux home prefix into a tilde', () => {
		expect(compactPath('/Users/me/dev/mizraj')).toBe('~/dev/mizraj')
		expect(compactPath('/home/walid/api')).toBe('~/api')
		expect(compactPath('/srv/api')).toBe('/srv/api')
		expect(compactPath(null)).toBe('—')
	})
})

describe('projectHue', () => {
	it('assigns each repo a stable hue from the palette, blue when repo-less', () => {
		const hue = projectHue('/Users/me/dev/mizraj')

		expect(projectHue('/Users/me/dev/mizraj')).toBe(hue)
		expect(HUES).toContain(hue)
		expect(projectHue(null)).toBe('blue')
	})

	it('spreads different repos across hues', () => {
		const paths = Array.from({ length: 24 }, (_, i) => `/repo/project-${i}`)
		const hues = new Set(paths.map(projectHue))

		expect(hues.size).toBeGreaterThan(1)
	})
})
