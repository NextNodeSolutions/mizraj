import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'
import type { Overview, Task } from '@/features/tasks/tasks'

import {
	groupColumnByRepo,
	pipelineColumns,
	primaryApproveSessionId,
} from './pipelineColumns'

const task = (id: string, status: Task['status']): Task => ({
	repoPath: '/repo/x',
	id,
	identifier: null,
	origin: 'track',
	milestoneId: 'm1',
	trackId: 't1',
	step: null,
	title: `Task ${id}`,
	description: null,
	doneWhen: null,
	size: null,
	sliceOf: [],
	sinkId: null,
	position: 0,
	status,
	blockedReason: status === 'blocked' ? 'waiting on infra' : null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
})

const session = (
	id: string,
	status: SessionState['status'],
	exitCode: number | null = null,
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	output: [],
	status,
	exitCode,
	startedAt: 0,
})

const overview = (
	tasks: ReadonlyArray<Task>,
	user: ReadonlyArray<Task>,
): Overview => ({
	milestones: [
		{
			id: 'm1',
			number: 1,
			demo: 'demo',
			skeleton: false,
			needs: [],
			tracks: [{ id: 't1', branch: 'feat/x', tasks }],
		},
	],
	userTasks: user,
})

const NONE_APPROVED: ReadonlySet<string> = new Set()

const isReviewable = (ended: SessionState): boolean => ended.exitCode === 0

describe('pipelineColumns', () => {
	it('routes tasks and sessions to their columns', () => {
		const columns = pipelineColumns(
			[
				overview(
					[
						task('a', 'backlog'),
						task('b', 'in_progress'),
						task('c', 'done'),
					],
					[task('u', 'backlog')],
				),
			],
			[session('run', 'running'), session('rev', 'ended', 0)],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual(['a', 'u'])
		expect(columns.inProgressTasks.map(entry => entry.task.id)).toEqual([
			'b',
		])
		expect(columns.runningSessions.map(s => s.id)).toEqual(['run'])
		expect(columns.endedSessions.map(s => s.id)).toEqual(['rev'])
		expect(columns.done.map(entry => entry.task.id)).toEqual(['c'])
	})

	it('moves approved ended sessions from review to done', () => {
		const columns = pipelineColumns(
			[],
			[session('kept', 'ended', 0), session('merged', 'ended', 0)],
			new Set(['merged']),
		)

		expect(columns.endedSessions.map(s => s.id)).toEqual(['kept'])
		expect(columns.doneSessions.map(s => s.id)).toEqual(['merged'])
	})

	it('keeps blocked tasks visible in the backlog', () => {
		const columns = pipelineColumns(
			[overview([task('x', 'blocked')], [])],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual(['x'])
	})

	it('carries the track branch onto task entries', () => {
		const columns = pipelineColumns(
			[overview([task('a', 'backlog')], [])],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog[0]?.branch).toBe('feat/x')
	})

	it('merges the overviews of every repo into the same columns', () => {
		const taskOfRepo = (id: string, repoPath: string): Task => ({
			...task(id, 'backlog'),
			repoPath,
		})
		const columns = pipelineColumns(
			[
				overview([taskOfRepo('a1', '/repo/alpha')], []),
				overview([taskOfRepo('b1', '/repo/beta')], []),
			],
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual([
			'a1',
			'b1',
		])
		expect(columns.backlog.map(entry => entry.task.repoPath)).toEqual([
			'/repo/alpha',
			'/repo/beta',
		])
	})

	it('groups a column by repo, sessions first, first-seen order', () => {
		const sessions = [
			{ ...session('s1', 'running'), repoPath: '/repo/beta' },
			{ ...session('s2', 'running'), repoPath: '/repo/alpha' },
		]
		const entries = [
			{
				task: { ...task('t1', 'in_progress'), repoPath: '/repo/alpha' },
				branch: null,
			},
		]

		const groups = groupColumnByRepo(sessions, entries)

		expect(groups.map(group => group.repoPath)).toEqual([
			'/repo/beta',
			'/repo/alpha',
		])
		expect(groups[1]?.sessions.map(s => s.id)).toEqual(['s2'])
		expect(groups[1]?.entries.map(entry => entry.task.id)).toEqual(['t1'])
	})

	it('handles no overview at all', () => {
		const columns = pipelineColumns(
			[],
			[session('run', 'running')],
			NONE_APPROVED,
		)

		expect(columns.backlog).toEqual([])
		expect(columns.runningSessions.map(s => s.id)).toEqual(['run'])
	})
})

describe('primaryApproveSessionId', () => {
	const ofRepo = (
		id: string,
		repoPath: string,
		exitCode: number,
	): SessionState => ({
		...session(id, 'ended', exitCode),
		repoPath,
	})

	it('targets the first reviewable card of the first repo group', () => {
		// Flat order puts beta's reviewable first, but alpha's group is seen
		// first (its failed card), so alpha's reviewable owns the primary.
		const ended = [
			ofRepo('alpha-fail', '/repo/alpha', 2),
			ofRepo('beta-review', '/repo/beta', 0),
			ofRepo('alpha-review', '/repo/alpha', 0),
		]

		expect(primaryApproveSessionId(ended, isReviewable)).toBe(
			'alpha-review',
		)
	})

	it('skips a group with no reviewable card', () => {
		const ended = [
			ofRepo('alpha-fail', '/repo/alpha', 2),
			ofRepo('beta-review', '/repo/beta', 0),
		]

		expect(primaryApproveSessionId(ended, isReviewable)).toBe('beta-review')
	})

	it('returns null when nothing is reviewable', () => {
		const ended = [
			ofRepo('alpha-fail', '/repo/alpha', 2),
			ofRepo('beta-fail', '/repo/beta', 1),
		]

		expect(primaryApproveSessionId(ended, isReviewable)).toBe(null)
	})
})
