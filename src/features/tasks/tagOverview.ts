import type { MilestoneGroup, Overview, Task, TrackGroup } from './tasks'

type WireTask = Omit<Task, 'repoPath'>

/** The `tasks_overview` payload shape — the domain tree minus the repo tag. */
export type WireOverview = {
	milestones: ReadonlyArray<
		Omit<MilestoneGroup, 'tracks'> & {
			tracks: ReadonlyArray<
				Omit<TrackGroup, 'tasks'> & { tasks: ReadonlyArray<WireTask> }
			>
		}
	>
	userTasks: ReadonlyArray<WireTask>
}

/**
 * Tag every task in a wire overview with its repo. The wire payload carries no
 * repo, so this stamps it at the fetch boundary: every later action on a task —
 * status change, edit, launch — targets the task's own repo, never the active
 * project (MP5). Pure wire→domain mapping, isolated from the IPC boundary.
 */
export const tagOverview = (
	wire: WireOverview,
	repoPath: string,
): Overview => ({
	milestones: wire.milestones.map(milestone => ({
		...milestone,
		tracks: milestone.tracks.map(track => ({
			...track,
			tasks: track.tasks.map(task => ({ ...task, repoPath })),
		})),
	})),
	userTasks: wire.userTasks.map(task => ({ ...task, repoPath })),
})
