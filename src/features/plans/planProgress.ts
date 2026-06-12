import type { MilestoneGroup, TrackGroup } from '@/features/tasks/tasks'

export type MilestoneState = 'done' | 'in progress' | 'todo'

/** A track is delivered once it has tasks and every one of them is done. */
export const isTrackDone = (track: TrackGroup): boolean =>
	track.tasks.length > 0 && track.tasks.every(task => task.status === 'done')

const hasStartedTask = (milestone: MilestoneGroup): boolean =>
	milestone.tracks.some(track =>
		track.tasks.some(task => task.status === 'in_progress'),
	)

/**
 * Where a milestone stands, derived from its tracks: delivered when every
 * track is done, moving as soon as any task started or any track landed,
 * waiting otherwise.
 */
export const milestoneState = (milestone: MilestoneGroup): MilestoneState => {
	const doneTracks = milestone.tracks.filter(isTrackDone).length
	if (doneTracks === milestone.tracks.length) return 'done'
	if (hasStartedTask(milestone) || doneTracks > 0) return 'in progress'
	return 'todo'
}
