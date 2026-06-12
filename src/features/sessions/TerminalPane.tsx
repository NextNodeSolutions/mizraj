import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import {
	activeSessionIdAtom,
	claimActiveSessionAtom,
	releaseActiveSessionAtom,
} from './sessions'
import { useTerminalCanvas } from './useTerminalCanvas'

type Props = {
	sessionId: string
}

export const TerminalPane = ({ sessionId }: Props): React.JSX.Element => {
	const { containerRef, canvasRef } = useTerminalCanvas(sessionId)
	const claim = useSetAtom(claimActiveSessionAtom)
	const release = useSetAtom(releaseActiveSessionAtom)
	// Splits dim the panes that don't own the keyboard (Ghostty's
	// unfocused-split-opacity affordance); a lone pane is always active.
	const active = useAtomValue(activeSessionIdAtom) === sessionId

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
			data-active={active}
			onPointerEnter={() => claim(sessionId)}
		>
			<canvas ref={canvasRef} className="terminal-pane__canvas" />
		</div>
	)
}
