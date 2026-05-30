import { atom, useAtomValue } from 'jotai'

import { sessionsAtom } from '../state/sessions'
import type { SessionState } from '../state/sessions'

// Ordered list view over the shared session map. The derived atom is defined at
// module scope (no per-render recreation) and jotai only recomputes it when
// sessionsAtom changes — i.e. on session start/end — so consumers re-render
// exactly when the living set changes. Object.values preserves the map's
// insertion order, which is the order sessions were started.
const sessionsListAtom = atom<ReadonlyArray<SessionState>>(get =>
	Object.values(get(sessionsAtom)),
)

export const useSessions = (): ReadonlyArray<SessionState> =>
	useAtomValue(sessionsListAtom)
