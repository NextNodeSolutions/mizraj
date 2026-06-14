import { useEffect, useState } from 'react'

import { useWorkingTreeTotals } from '@/features/review/useWorkingTreeTotals'
import { closeSession } from '@/features/sessions/closeSession'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { openSession, openSessionReview } from '@/features/sessions/openSession'
import {
	sessionLabel,
	sessionRepoLabel,
} from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import { DiffStat, StatusTag } from '@/shared/ui/atoms'

import { TerminalPreview } from './TerminalPreview'

const TAIL_LINES = 2

type Props = {
	session: SessionState
	/** Just moved into this column — mounts with the spring entrance. */
	fresh?: boolean
	/** First card of its column — its Approve renders as the primary button. */
	isFirst?: boolean
	/** Approve handler for review cards; the view owns the optimistic move. */
	onApprove?: () => void
	/** Fires when the entrance animation ends, so the view can drop its id. */
	onAnimationEnd?: () => void
}

const stopSession = (sessionId: string): void => {
	void closeSession(sessionId)
}

export const PipelineSessionCard = ({
	session,
	fresh = false,
	isFirst = false,
	onApprove,
	onAnimationEnd,
}: Props): React.JSX.Element => {
	const status = sessionDisplayStatus(session)
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TAIL_LINES)
	const running = status === 'running'
	const stat = useWorkingTreeTotals(running ? null : session.repoPath)
	//TODO: per-session branch — SessionState has no branch (sessions run
	// directly in repoPath; worktree.rs spawn_worktree is unused by
	// session_create and repo_head only resolves the active project).
	// Rendering sessionRepoLabel(session) as the branch-slot stand-in until
	// sessions carry a ref_name/worktree.
	const repoLabel = sessionRepoLabel(session)
	// Guards the approve action: the optimistic move + (future) merge command
	// must fire once. A second click before the card leaves Review would
	// double-fire it, so the button latches disabled on the first click.
	const [approving, setApproving] = useState(false)

	const runApprove = (): void => {
		if (approving) return
		setApproving(true)
		onApprove?.()
	}

	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<article
			className="pipeline__card"
			data-status={status}
			data-anim={fresh ? 'in' : undefined}
			onAnimationEnd={onAnimationEnd}
		>
			<div className="pipeline__card-row">
				<StatusTag status={status} />
				{repoLabel !== null && (
					<span className="pipeline__branch">{repoLabel}</span>
				)}
			</div>
			<p className="pipeline__title">{sessionLabel(session)}</p>
			{running && <TerminalPreview tail={tail} />}
			{!running && stat !== null && (
				<DiffStat
					add={stat.additions}
					del={stat.deletions}
					files={stat.files}
				/>
			)}
			<div className="pipeline__card-actions">
				{status === 'review' ? (
					<>
						<button
							type="button"
							className={
								isFirst
									? 'btn btn-primary btn-sm'
									: 'btn btn-outline btn-sm'
							}
							disabled={approving}
							onClick={runApprove}
						>
							✓ Approve
						</button>
						<button
							type="button"
							className="btn btn-outline btn-sm"
							onClick={() => openSessionReview(session)}
						>
							Review
						</button>
					</>
				) : (
					<button
						type="button"
						className="btn btn-outline btn-sm"
						onClick={() => openSession(session)}
					>
						Open
					</button>
				)}
				{running && (
					<button
						type="button"
						className="btn btn-ghost btn-sm"
						onClick={() => stopSession(session.id)}
					>
						◼ Stop
					</button>
				)}
			</div>
		</article>
	)
}
