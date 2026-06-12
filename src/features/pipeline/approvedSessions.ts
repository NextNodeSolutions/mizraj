import { atom } from 'jotai'

/**
 * Session ids the user approved from the Review column. Client-only,
 * optimistic state: approving has no backend yet, so the board moves the
 * card to Done from this set alone (see PipelineView's approve handler).
 */
export const approvedSessionIdsAtom = atom<ReadonlySet<string>>(
	new Set<string>(),
)

/** Flag a session as approved — its card leaves Review for Done. */
export const approveSessionAtom = atom(
	null,
	(get, set, sessionId: string): void => {
		set(
			approvedSessionIdsAtom,
			new Set(get(approvedSessionIdsAtom)).add(sessionId),
		)
	},
)
