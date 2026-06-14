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

/**
 * Drop approved ids whose session no longer exists in the live set — a
 * session can vanish (closed, pruned) after the user approved it, and the
 * client-only approved set has no other way to forget it, so it would only
 * grow. A no-op (returns the same reference) when nothing is stale, so the
 * caller can skip a redundant write.
 */
export const pruneApprovedSessionsAtom = atom(
	null,
	(get, set, liveSessionIds: ReadonlySet<string>): void => {
		const approved = get(approvedSessionIdsAtom)
		const pruned = new Set(
			[...approved].filter(id => liveSessionIds.has(id)),
		)
		if (pruned.size === approved.size) return
		set(approvedSessionIdsAtom, pruned)
	},
)
