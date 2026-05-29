import { atom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { sessionsAtom } from '../state/sessions'
import type { SessionState } from '../state/sessions'

// Selects a single session from the shared map. The derived atom is memoized on
// `sessionId` so it isn't recreated each render (a fresh atom would resubscribe
// and defeat jotai's caching).
export const useSession = (sessionId: string): SessionState | undefined => {
	const sessionAtom = useMemo(
		() => atom(get => get(sessionsAtom)[sessionId]),
		[sessionId],
	)
	return useAtomValue(sessionAtom)
}
