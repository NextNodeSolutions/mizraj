import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'

import {
	HUES,
	compactPath,
	dormantRepos,
	groupSessionsByRepo,
	orderProjectGroups,
	projectHue,
	projectName,
	withActiveGroup,
} from './projectGroups'

const session = (
	id: string,
	overrides: Partial<Omit<SessionState, 'id'>> = {},
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/Users/me/dev/mizraj',
	title: null,
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

describe('dormantRepos', () => {
	it('keeps registry repos with no live session, in registry order', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
			session('loose', { repoPath: null }),
		])

		const dormant = dormantRepos(
			groups,
			['/repo/sleepy', '/repo/x', '/repo/idle'],
			null,
		)

		expect(dormant).toEqual(['/repo/sleepy', '/repo/idle'])
	})

	it('is empty when every registered repo has sessions', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
		])

		expect(dormantRepos(groups, ['/repo/x'], null)).toEqual([])
	})

	it('dedupes a registry that lists the same repo twice', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
		])

		const dormant = dormantRepos(
			groups,
			['/repo/sleepy', '/repo/sleepy', '/repo/idle'],
			null,
		)

		expect(dormant).toEqual(['/repo/sleepy', '/repo/idle'])
	})

	it('never lists the followed repo as dormant, even with no session', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
		])

		const dormant = dormantRepos(
			groups,
			['/repo/active', '/repo/idle'],
			'/repo/active',
		)

		expect(dormant).toEqual(['/repo/idle'])
	})
})

describe('withActiveGroup', () => {
	it('pins an empty group for a followed repo that has no session', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/busy' }),
		])

		const withActive = withActiveGroup(groups, '/repo/active')

		expect(withActive.map(group => group.repoPath)).toEqual([
			'/repo/active',
			'/repo/busy',
		])
		expect(withActive[0]?.sessions).toEqual([])
	})

	it('leaves the groups untouched when the followed repo already has one', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/active' }),
		])

		expect(withActiveGroup(groups, '/repo/active')).toBe(groups)
	})

	it('adds nothing when no repo is followed', () => {
		const groups = groupSessionsByRepo([
			session('a', { repoPath: '/repo/x' }),
		])

		expect(withActiveGroup(groups, null)).toBe(groups)
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
