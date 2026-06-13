import { describe, expect, it } from 'vitest'

import type { SessionState } from '@/features/sessions/sessions'
import type { Overview, Task } from '@/features/tasks/tasks'

import { pipelineColumns } from './pipelineColumns'

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

describe('pipelineColumns', () => {
	it('routes tasks and sessions to their columns', () => {
		const columns = pipelineColumns(
			overview(
				[
					task('a', 'backlog'),
					task('b', 'in_progress'),
					task('c', 'done'),
				],
				[task('u', 'backlog')],
			),
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
			null,
			[session('kept', 'ended', 0), session('merged', 'ended', 0)],
			new Set(['merged']),
		)

		expect(columns.endedSessions.map(s => s.id)).toEqual(['kept'])
		expect(columns.doneSessions.map(s => s.id)).toEqual(['merged'])
	})

	it('keeps blocked tasks visible in the backlog', () => {
		const columns = pipelineColumns(
			overview([task('x', 'blocked')], []),
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog.map(entry => entry.task.id)).toEqual(['x'])
	})

	it('carries the track branch onto task entries', () => {
		const columns = pipelineColumns(
			overview([task('a', 'backlog')], []),
			[],
			NONE_APPROVED,
		)

		expect(columns.backlog[0]?.branch).toBe('feat/x')
	})

	it('handles a missing overview', () => {
		const columns = pipelineColumns(
			null,
			[session('run', 'running')],
			NONE_APPROVED,
		)

		expect(columns.backlog).toEqual([])
		expect(columns.runningSessions.map(s => s.id)).toEqual(['run'])
	})
})
