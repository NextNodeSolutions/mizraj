import { invoke } from '@tauri-apps/api/core'

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

export type TasksState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; tasks: ReadonlyArray<Task> }
	| { status: 'error'; message: string }

const fetchTasks = (repoPath: string): Promise<ReadonlyArray<Task>> =>
	invoke<ReadonlyArray<Task>>('tasks_list', { repoPath })

export const useTasks = (repoPath: string | null): TasksState => {
	const state = useRepoResource(
		repoPath,
		fetchTasks,
		'tasks-view',
		'useTasks: tasks_list',
	)
	return state.status === 'ready'
		? { status: 'ready', tasks: state.data }
		: state
}
