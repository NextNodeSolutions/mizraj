import { extractGridText } from './gridText'
import type { CellFramePayload } from './terminalWire'

/**
 * The last `maxLines` non-blank lines of a session's terminal grid — the
 * "what is it doing right now" preview an agent card shows. No frame (the
 * session was never subscribed, or hasn't painted yet) yields no lines.
 */
export const terminalTail = (
	frame: CellFramePayload | undefined,
	maxLines: number,
): ReadonlyArray<string> => {
	if (!frame) return []
	const lines = extractGridText(frame)
		.split('\n')
		.filter(line => line.trim() !== '')
	return lines.slice(-maxLines)
}
