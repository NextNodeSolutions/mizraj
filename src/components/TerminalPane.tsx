import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { useTerminalCanvas } from '../lib/useTerminalCanvas'
import {
	claimActiveSessionAtom,
	releaseActiveSessionAtom,
} from '../state/sessions'

type Props = {
	sessionId: string
}

const TerminalPane = ({ sessionId }: Props): React.JSX.Element => {
	const { containerRef, canvasRef } = useTerminalCanvas(sessionId)
	const claim = useSetAtom(claimActiveSessionAtom)
	const release = useSetAtom(releaseActiveSessionAtom)

	// Sync the shared "active pane" store with this pane's lifecycle: claim the
	// keyboard on mount so a freshly opened terminal types without moving the
	// mouse, release it on unmount.
	useEffect(() => {
		claim(sessionId)
		return () => release(sessionId)
	}, [sessionId, claim, release])

	return (
		<div
			ref={containerRef}
			className="terminal-pane"
			onPointerEnter={() => claim(sessionId)}
		>
			<canvas ref={canvasRef} className="terminal-pane__canvas" />
		</div>
	)
}

export default TerminalPane
