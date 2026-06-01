import { useTerminalCanvas } from '../lib/useTerminalCanvas'

type Props = {
	sessionId: string
}

const TerminalPane = ({ sessionId }: Props): React.JSX.Element => {
	const { containerRef, canvasRef } = useTerminalCanvas(sessionId)

	return (
		<div ref={containerRef} className="terminal-pane">
			<canvas ref={canvasRef} className="terminal-pane__canvas" />
		</div>
	)
}

export default TerminalPane
