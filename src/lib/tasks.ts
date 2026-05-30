import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type Task = {
	id: string
	title: string
	description: string | null
	status: TaskStatus
	repoPath: string
	createdAt: string
}

export type TasksState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; tasks: ReadonlyArray<Task> }
	| { status: 'error'; message: string }

const fetchTasks = (repoPath: string): Promise<Task[]> =>
	invoke<Task[]>('tasks_list', { repoPath })

export const useTasks = (repoPath: string | null): TasksState => {
	const [state, setState] = useState<TasksState>({ status: 'idle' })

	useEffect(() => {
		if (repoPath === null) {
			setState({ status: 'idle' })
			return
		}

		let cancelled = false

		const reload = async (): Promise<void> => {
			try {
				const tasks = await fetchTasks(repoPath)
				if (!cancelled) setState({ status: 'ready', tasks })
			} catch (error: unknown) {
				const { message, stack } = describeError(error)
				logger.error(`useTasks: tasks_list failed: ${message}`, {
					scope: 'tasks-view',
					details: { stack, repoPath },
				})
				if (!cancelled) setState({ status: 'error', message })
			}
		}

		setState({ status: 'loading' })
		void reload()

		const unlistenPromise = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (focused) void reload()
			},
		)

		return () => {
			cancelled = true
			void unlistenPromise.then(off => off())
		}
	}, [repoPath])

	return state
}
