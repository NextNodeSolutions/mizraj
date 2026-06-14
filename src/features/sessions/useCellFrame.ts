import { atom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { cellFramesAtom } from './sessions'
import type { CellFramePayload } from './terminalWire'

// Selects one session's latest cell frame from the shared map. Memoized on
// `sessionId` so the derived atom isn't recreated each render (same pattern
// as useSession).
export const useCellFrame = (
	sessionId: string,
): CellFramePayload | undefined => {
	const frameAtom = useMemo(
		() => atom(get => get(cellFramesAtom)[sessionId]),
		[sessionId],
	)
	return useAtomValue(frameAtom)
}
