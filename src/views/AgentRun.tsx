import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

import DiffPanel from '../components/DiffPanel'
import TerminalPane from '../components/TerminalPane'
import { describeError } from '../errors'
import { useSession } from '../lib/useSession'
import { logger } from '../logger'

type Props = {
	sessionId: string
}

const stopSession = (sessionId: string): void => {
	invoke('session_close', { sessionId }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.error(`AgentRun: session_close failed: ${message}`, {
			scope: 'agent-run',
			details: { stack, sessionId },
		})
	})
}

const AgentRun = ({ sessionId }: Props): React.JSX.Element => {
	const session = useSession(sessionId)
	const ended = session?.status === 'ended'

	const [diffOpen, setDiffOpen] = useState(false)
	// Auto-open the diff once, on the transition to `ended` (D8). Tracking the
	// previous `ended` value and adjusting state during render — rather than an
	// effect — keeps this a one-shot reaction to the transition: a later manual
	// close sticks, and the Diffs button can still reopen it.
	const [endedSeen, setEndedSeen] = useState(ended)
	if (ended !== endedSeen) {
		setEndedSeen(ended)
		if (ended) setDiffOpen(true)
	}

	return (
		<div className="agent-run">
			<button
				type="button"
				className="agent-run__stop"
				onClick={() => stopSession(sessionId)}
				disabled={ended}
			>
				Stop
			</button>
			<div className="agent-run__log">
				<TerminalPane sessionId={sessionId} />
			</div>
			{!diffOpen && (
				<button
					type="button"
					className="agent-run__diff-handle"
					onClick={() => setDiffOpen(true)}
				>
					Diffs
				</button>
			)}
			<aside
				className="agent-run__diff"
				data-open={diffOpen}
				aria-hidden={!diffOpen}
			>
				<DiffPanel onClose={() => setDiffOpen(false)} />
			</aside>
		</div>
	)
}

export default AgentRun
