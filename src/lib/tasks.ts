import { invoke } from '@tauri-apps/api/core'

import type { RepoResource, ResourceState } from './repoResource'
import { useRepoResource } from './repoResource'

export const TASK_STATUSES = ['backlog', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type TaskOrigin = 'user' | 'track'

export type Task = {
	id: string
	title: string
	description: string | null
	status: TaskStatus
	origin: TaskOrigin
	createdAt: string
}

export type TasksState = ResourceState<ReadonlyArray<Task>>

const fetchTasks = (repoPath: string): Promise<ReadonlyArray<Task>> =>
	invoke<ReadonlyArray<Task>>('tasks_list', { repoPath })

/**
 * Create a `user`-origin task in `repoPath` and return the persisted row. The
 * backend rejects a blank title and stores a blank description as `NULL`.
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
	id: string
	title: string
	description: string | null
	status: string
}): Promise<Task> => invoke<Task>('tasks_update', input)

export const useTasks = (
	repoPath: string | null,
): RepoResource<ReadonlyArray<Task>> =>
	useRepoResource(repoPath, fetchTasks, 'tasks-view', 'useTasks: tasks_list')
