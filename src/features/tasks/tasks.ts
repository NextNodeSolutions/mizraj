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

/**
 * Read the active project's grouped task tree plus its flat user tasks. The
 * backend resolves the active project itself, so this takes no arguments — a
 * nullary fetcher is assignable where {@link useRepoResource} expects its
 * `(repoPath: string) => Promise<T>` signature, so the keyed `repoPath` still
 * re-triggers the fetch on project switch without this function reading it.
 */
const fetchOverview = (): Promise<Overview> =>
	invoke<Overview>('tasks_overview')

/**
 * Create a `user`-origin task in the active project and return the persisted
 * row. The backend rejects a blank title and stores a blank description as
 * `NULL`.
 */
export const createTask = (
	title: string,
	description: string,
): Promise<Task> => {
	const trimmed = description.trim()
	return invoke<Task>('tasks_create', {
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
