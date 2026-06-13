import { invoke } from '@tauri-apps/api/core'

import type { RepoResource, ResourceState } from '@/shared/repoResource'
import { useRepoResource } from '@/shared/repoResource'

export const TASK_STATUSES = [
	'backlog',
	'in_progress',
	'done',
	'blocked',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type TaskOrigin = 'user' | 'track'

export type Task = {
	/**
	 * The repo this task belongs to, tagged at the fetch boundary (the wire
	 * payload carries no repo): every action on a task — status change, edit,
	 * launch — targets the task's own repo, never the active project (MP5).
	 */
	repoPath: string
	id: string
	identifier: string | null
	origin: TaskOrigin
	milestoneId: string | null
	trackId: string | null
	step: string | null
	title: string
	description: string | null
	doneWhen: string | null
	size: string | null
	sliceOf: ReadonlyArray<string>
	sinkId: string | null
	position: number
	status: TaskStatus
	blockedReason: string | null
	commitSha: string | null
	createdAt: string
}

export type TrackGroup = {
	id: string
	branch: string
	tasks: ReadonlyArray<Task>
}

export type MilestoneGroup = {
	id: string
	number: number
	demo: string
	skeleton: boolean
	needs: ReadonlyArray<string>
	tracks: ReadonlyArray<TrackGroup>
}

export type Overview = {
	milestones: ReadonlyArray<MilestoneGroup>
	userTasks: ReadonlyArray<Task>
}

export type OverviewState = ResourceState<Overview>

type WireTask = Omit<Task, 'repoPath'>

type WireOverview = {
	milestones: ReadonlyArray<
		Omit<MilestoneGroup, 'tracks'> & {
			tracks: ReadonlyArray<
				Omit<TrackGroup, 'tasks'> & { tasks: ReadonlyArray<WireTask> }
			>
		}
	>
	userTasks: ReadonlyArray<WireTask>
}

const tagOverview = (wire: WireOverview, repoPath: string): Overview => ({
	milestones: wire.milestones.map(milestone => ({
		...milestone,
		tracks: milestone.tracks.map(track => ({
			...track,
			tasks: track.tasks.map(task => ({ ...task, repoPath })),
		})),
	})),
	userTasks: wire.userTasks.map(task => ({ ...task, repoPath })),
})

/**
 * Read `repoPath`'s grouped task tree plus its flat user tasks. The repo is
 * explicit (MP1): any registered repo can be read at any time, in parallel
 * with the others — no active-project switch involved.
 */
const fetchOverview = async (repoPath: string): Promise<Overview> => {
	const wire = await invoke<WireOverview>('tasks_overview', { repoPath })
	return tagOverview(wire, repoPath)
}

/**
 * Create a `user`-origin task in `repoPath`'s project and return the
 * persisted row. The backend rejects a blank title and stores a blank
 * description as `NULL`.
 */
export const createTask = (
	repoPath: string,
	title: string,
	description: string,
): Promise<Task> => {
	const trimmed = description.trim()
	return invoke<Task>('tasks_create', {
		repoPath,
		title,
		description: trimmed === '' ? null : trimmed,
	})
}

/**
 * Persist the editable fields of a task — title, description, status — and
 * return the updated row. Callers send the task's full editable state, so a
 * status change never clobbers an in-flight content edit and vice versa.
 * `status` is the raw value and `description` may be blank; the backend is the
 * authoritative validator — it rejects a blank title, stores a blank
 * description as `NULL`, and rejects a status outside {@link TASK_STATUSES}.
 */
export const updateTask = (input: {
	repoPath: string
	id: string
	title: string
	description: string | null
	status: string
}): Promise<Task> => invoke<Task>('tasks_update', input)

export const useTasks = (repoPath: string | null): RepoResource<Overview> =>
	useRepoResource(
		repoPath,
		fetchOverview,
		'tasks-view',
		'useTasks: tasks_overview',
	)
