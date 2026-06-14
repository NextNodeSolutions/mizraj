import { useState } from 'react'

import { missionControlHref, navigate } from '@/app/router'
import { spawnSession } from '@/features/sessions/launchSession'
import type { MilestoneGroup, TrackGroup } from '@/features/tasks/tasks'
import { pushToast } from '@/shared/toasts'

import { isTrackDone } from './planProgress'

const AGENT_BINARY = 'claude'

const pendingTracksOf = (
	milestones: ReadonlyArray<MilestoneGroup>,
): ReadonlyArray<TrackGroup> =>
	milestones.flatMap(milestone =>
		milestone.tracks.filter(track => !isTrackDone(track)),
	)

const spawnAgentsFor = async (
	tracks: ReadonlyArray<TrackGroup>,
	repoPath: string,
): Promise<number> => {
	// TODO: launch agents in per-track worktrees on track.branch; spawn_worktree exists in src-tauri/src/worktree.rs but is not a registered command and session_create only takes (binary, cwd) — all agents currently start in the repo root
	// TODO: no way to pass an initial prompt/task list to session_create; agents start bare claude
	const sessionIds = await Promise.all(
		tracks.map(() => spawnSession({ binary: AGENT_BINARY, repoPath })),
	)
	return sessionIds.filter(sessionId => sessionId !== null).length
}

type Props = {
	repoPath: string | null
	milestones: ReadonlyArray<MilestoneGroup>
}

/**
 * "▶ Launch agents for this plan" — spawn one claude session per track that
 * is not done yet, toast the tally and head to Mission Control to watch
 * them. Disabled without a project or once every track has landed.
 */
export const LaunchPlanAgentsButton = ({
	repoPath,
	milestones,
}: Props): React.JSX.Element => {
	const [launching, setLaunching] = useState(false)
	const pendingTracks = pendingTracksOf(milestones)

	const launchAgents = async (path: string): Promise<void> => {
		setLaunching(true)
		const total = pendingTracks.length
		const launched = await spawnAgentsFor(pendingTracks, path)
		setLaunching(false)
		const failed = total - launched
		pushToast(
			failed === 0
				? `${launched} agents launched from this plan`
				: `${launched}/${total} agents launched, ${failed} failed`,
		)
		navigate(missionControlHref())
	}

	return (
		<button
			type="button"
			className="btn btn-primary"
			disabled={
				launching || repoPath === null || pendingTracks.length === 0
			}
			aria-busy={launching}
			onClick={() => {
				if (repoPath !== null) void launchAgents(repoPath)
			}}
		>
			▶ Launch agents for this plan
		</button>
	)
}
