import { invoke } from '@tauri-apps/api/core'

import { useRepoResource } from './repoResource'

export const TASK_STATES = [
	'in_progress',
	'pending',
	'done',
	'blocked',
] as const
export type TaskState = (typeof TASK_STATES)[number]

export type TrackTask = {
	identifier: string
	title: string
	state: TaskState
	commit: string | null
}

export type Track = {
	title: string
	milestone: string
	tasks: ReadonlyArray<TrackTask>
}

export type TrackState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; track: Track | null }
	| { status: 'error'; message: string }

const fetchTrack = (repoPath: string): Promise<Track | null> =>
	invoke<Track | null>('track_read', { repoPath })

export const useTrack = (repoPath: string | null): TrackState => {
	const state = useRepoResource(
		repoPath,
		fetchTrack,
		'tasks-view',
		'useTrack: track_read',
	)
	return state.status === 'ready'
		? { status: 'ready', track: state.data }
		: state
}
