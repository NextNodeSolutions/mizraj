import { useState } from 'react'

import DiffPanel from '../components/DiffPanel'
import GhosttyLog from '../components/GhosttyLog'

type Props = {
	sessionId: string
}

const AgentRun = ({ sessionId }: Props): React.JSX.Element => {
	const [diffOpen, setDiffOpen] = useState(false)

	return (
		<div className="agent-run">
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
				<DiffPanel sessionId={sessionId} onClose={() => setDiffOpen(false)} />
			</aside>
		</div>
	)
}

export default AgentRun
