import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

import { agentRunHref, navigate, reviewHref } from '@/app/router'
import {
	DISPLAY_STATUS_LABEL,
	sessionDisplayStatus,
} from '@/features/sessions/displayStatus'
import { sessionLabel } from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

const TAIL_LINES = 1

type Props = {
	session: SessionState
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

export const PipelineSessionCard = ({ session }: Props): React.JSX.Element => {
	const status = sessionDisplayStatus(session)
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TAIL_LINES)
	const running = status === 'running'

	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<article className="pipeline__card" data-status={status}>
			<div className="pipeline__card-row">
				<span className="status-dot" data-status={status} />
				<span className="pipeline__tag" data-status={status}>
					{DISPLAY_STATUS_LABEL[status]}
				</span>
			</div>
			<p className="pipeline__title">{sessionLabel(session)}</p>
			{running && <p className="pipeline__term">{tail[0] ?? '…'}</p>}
			<div className="pipeline__card-actions">
				{status === 'review' ? (
					<button
						type="button"
						className="pipeline__action pipeline__action--primary"
						onClick={() => navigate(reviewHref())}
					>
						Review →
					</button>
				) : (
					<button
						type="button"
						className="pipeline__action"
						onClick={() => navigate(agentRunHref(session.id))}
					>
						Open
					</button>
				)}
				{running && (
					<button
						type="button"
						className="pipeline__action"
						onClick={() => stopSession(session.id)}
					>
						◼ Stop
					</button>
				)}
			</div>
		</article>
	)
}
