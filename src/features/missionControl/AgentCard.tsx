import { useEffect } from 'react'

import { agentRunHref, navigate, reviewHref } from '@/app/router'
import {
	DISPLAY_STATUS_LABEL,
	sessionDisplayStatus,
} from '@/features/sessions/displayStatus'
import { sessionLabel, sessionRepoLabel } from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'
import { subscribeToCellFrames } from '@/features/sessions/sessionSubscription'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'

import { formatSessionAge } from './sessionAge'

const TERMINAL_TAIL_LINES = 2

type Props = {
	session: SessionState
	now: number
}

// A running or failed agent re-opens its terminal; a cleanly ended one goes
// straight to the diff review.
const cardTarget = (session: SessionState): string =>
	sessionDisplayStatus(session) === 'review'
		? reviewHref()
		: agentRunHref(session.id)

export const AgentCard = ({ session, now }: Props): React.JSX.Element => {
	const status = sessionDisplayStatus(session)
	const frame = useCellFrame(session.id)
	const tail = terminalTail(frame, TERMINAL_TAIL_LINES)
	const repoLabel = sessionRepoLabel(session)

	// Watching is what makes the backend emit frames for this session at all —
	// the card subscribes while visible, exactly like a terminal pane does.
	useEffect(() => subscribeToCellFrames(session.id), [session.id])

	return (
		<button
			type="button"
			className="agent-card"
			data-status={status}
			onClick={() => navigate(cardTarget(session))}
		>
			<span className="agent-card__top">
				<span className="status-dot" data-status={status} />
				<span className="agent-card__tag" data-status={status}>
					{DISPLAY_STATUS_LABEL[status]}
				</span>
				{repoLabel !== null && (
					<span className="agent-card__repo">{repoLabel}</span>
				)}
			</span>
			<span className="agent-card__title">{sessionLabel(session)}</span>
			<span className="agent-card__term" aria-hidden="true">
				{tail.length === 0 ? '…' : tail.join('\n')}
			</span>
			<span className="agent-card__foot">
				<span className="agent-card__age">
					{formatSessionAge(now, session.startedAt)}
				</span>
				{status === 'review' && (
					<span className="agent-card__cta">Review →</span>
				)}
			</span>
		</button>
	)
}
