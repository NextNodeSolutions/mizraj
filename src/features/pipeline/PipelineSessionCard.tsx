import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

import { agentRunHref, navigate, reviewHref } from '@/app/router'
import type { DiffTotals } from '@/features/review/reviewFiles'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import {
	sessionLabel,
	sessionRepoLabel,
} from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { DiffStat, StatusTag } from '@/shared/ui/atoms'

const TAIL_LINES = 2

type Props = {
	session: SessionState
	/** Working-tree diff totals, shown on ended cards (null while loading). */
	stat?: DiffTotals | null
	/** Just moved into this column — mounts with the spring entrance. */
	fresh?: boolean
	/** First card of its column — its Approve renders as the primary button. */
	isFirst?: boolean
	/** Approve handler for review cards; the view owns the optimistic move. */
	onApprove?: () => void
}

const stopSession = (sessionId: string): void => {
	invoke('session_close', { sessionId }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.error(`PipelineSessionCard: session_close failed: ${message}`, {
			scope: 'pipeline',
			details: { stack, sessionId },
		})
	})
}

type TerminalPreviewProps = {
	tail: ReadonlyArray<string>
}

// At most TAIL_LINES lines, rendered without a list so no synthetic keys are
// needed; the blinking caret rides the most recent line.
const TerminalPreview = ({ tail }: TerminalPreviewProps): React.JSX.Element => (
	<div className="term mini-term pipeline__term">
		{tail.length > 1 && <div className="term-line">{tail[0]}</div>}
		<div className="term-line">
			{tail.length === 0 ? '…' : tail[tail.length - 1]}
			<span className="caret" />
		</div>
	</div>
)

export const PipelineSessionCard = ({
	session,
	stat = null,
	fresh = false,
	isFirst = false,
	onApprove,
}: Props): React.JSX.Element => {
	const status = sessionDisplayStatus(session)
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TAIL_LINES)
	const running = status === 'running'
	//TODO: per-session branch — SessionState has no branch (sessions run
	// directly in repoPath; worktree.rs spawn_worktree is unused by
	// session_create and repo_head only resolves the active project).
	// Rendering sessionRepoLabel(session) as the branch-slot stand-in until
	// sessions carry a ref_name/worktree.
	const repoLabel = sessionRepoLabel(session)

	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<article
			className="pipeline__card"
			data-status={status}
			data-anim={fresh ? 'in' : undefined}
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
							onClick={onApprove}
						>
							✓ Approve
						</button>
						<button
							type="button"
							className="btn btn-outline btn-sm"
							onClick={() => navigate(reviewHref())}
						>
							Review
						</button>
					</>
				) : (
					<button
						type="button"
						className="btn btn-outline btn-sm"
						onClick={() => navigate(agentRunHref(session.id))}
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
