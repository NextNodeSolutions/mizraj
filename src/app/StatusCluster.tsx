import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { useSessions } from '@/features/sessions/useSessions'
import { SDot } from '@/shared/ui/atoms'

import { missionControlHref, navigate } from './router'

/**
 * The topbar's live pulse: how many agents run right now, how many wait on
 * the user — each pill deep-links mission control pre-filtered.
 */
export const StatusCluster = (): React.JSX.Element => {
	const sessions = useSessions()
	const runningCount = sessions.filter(
		session => sessionDisplayStatus(session) === 'running',
	).length
	const reviewCount = sessions.filter(
		session => sessionDisplayStatus(session) === 'review',
	).length

	// TODO(subagents): surface the Claude subagent count ('+N sub' chip)
	// when the backend reports a subagent feed per session.
	// TODO(merged): no merge tracking; omit the merged filter/count in shell
	// surfaces until the backend records merged branches.
	return (
		<div className="mz-status">
			<button
				type="button"
				className="mz-statbtn"
				title="Jump to running agents"
				onClick={() => navigate(missionControlHref('running'))}
			>
				<SDot s="run" />
				<b>{runningCount}</b>
				<span className="sl">running</span>
			</button>
			<button
				type="button"
				className="mz-statbtn mz-statbtn-rev"
				title="Jump to agents waiting on you"
				onClick={() => navigate(missionControlHref('review'))}
			>
				<SDot s="rev" />
				<b>{reviewCount}</b>
				<span className="sl">to review</span>
			</button>
		</div>
	)
}
