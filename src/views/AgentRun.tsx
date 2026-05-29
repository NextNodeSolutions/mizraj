import DiffPanel from '../components/DiffPanel'
import GhosttyLog from '../components/GhosttyLog'

type Props = {
	sessionId: string
}

const AgentRun = ({ sessionId }: Props): React.JSX.Element => (
	<div className="agent-run">
		<div className="agent-run__log">
			<GhosttyLog sessionId={sessionId} />
		</div>
		<div className="agent-run__diff">
			<DiffPanel sessionId={sessionId} />
		</div>
	</div>
)

export default AgentRun
