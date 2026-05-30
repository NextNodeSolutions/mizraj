import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

import DiffPanel from '../components/DiffPanel'
import GhosttyLog from '../components/GhosttyLog'
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
	const [diffOpen, setDiffOpen] = useState(false)
	const session = useSession(sessionId)
	const ended = session?.status === 'ended'

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
				<GhosttyLog sessionId={sessionId} />
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
				<DiffPanel
					sessionId={sessionId}
					onClose={() => setDiffOpen(false)}
				/>
			</aside>
		</div>
	)
}

export default AgentRun
