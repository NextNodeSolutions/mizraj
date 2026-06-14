import { describe, expect, it } from 'vitest'

import type {
	MilestoneGroup,
	Task,
	TaskStatus,
	TrackGroup,
} from '@/features/tasks/tasks'

import { isTrackDone, milestoneState } from './planProgress'

const task = (status: TaskStatus): Task => ({
	repoPath: '/repo/x',
	id: `task-${status}`,
	identifier: null,
	origin: 'track',
	milestoneId: null,
	trackId: null,
	step: null,
	title: 'A task',
	description: null,
	doneWhen: null,
	size: null,
	sliceOf: [],
	sinkId: null,
	position: 0,
	status,
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-06-01T00:00:00Z',
})

const track = (
	id: string,
	...statuses: ReadonlyArray<TaskStatus>
): TrackGroup => ({
	id,
	branch: `feat/${id}`,
	tasks: statuses.map(task),
})

const milestone = (tracks: ReadonlyArray<TrackGroup>): MilestoneGroup => ({
	id: 'm1',
	number: 1,
	demo: 'Login works',
	skeleton: false,
	needs: [],
	tracks,
})

describe('isTrackDone', () => {
	it('is done only when every task is done', () => {
		expect(isTrackDone(track('a', 'done', 'done'))).toBe(true)
		expect(isTrackDone(track('a', 'done', 'in_progress'))).toBe(false)
	})

	it('never reports an empty track as done', () => {
		expect(isTrackDone(track('a'))).toBe(false)
	})
})

describe('milestoneState', () => {
	it('is done when every track is done', () => {
		expect(
			milestoneState(milestone([track('a', 'done'), track('b', 'done')])),
		).toBe('done')
	})

	it('is in progress when any task is started', () => {
		expect(
			milestoneState(
				milestone([track('a', 'in_progress'), track('b', 'backlog')]),
			),
		).toBe('in progress')
	})

	it('is in progress when some but not all tracks are done', () => {
		expect(
			milestoneState(
				milestone([track('a', 'done'), track('b', 'backlog')]),
			),
		).toBe('in progress')
	})

	it('is todo when nothing has started', () => {
		expect(
			milestoneState(
				milestone([track('a', 'backlog'), track('b', 'blocked')]),
			),
		).toBe('todo')
	})

	it('is todo when the milestone has no tracks', () => {
		expect(milestoneState(milestone([]))).toBe('todo')
	})
})
