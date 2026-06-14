import { useEffect, useState } from 'react'

type FreshSessionIds = {
	freshSessionIds: ReadonlySet<string>
	/** Mark a session's card to play its spring entrance. */
	markFresh: (sessionId: string) => void
	/** Drop a session's id once its entrance animation ends. */
	clearFresh: (sessionId: string) => void
}

/**
 * The set of session ids whose pipeline card is playing its entrance spring
 * (just launched or approved). A card normally drops its id on animationEnd,
 * but under `prefers-reduced-motion: reduce` the animation (and its end event)
 * never fires — so the set is also mirrored against the live sessions to keep
 * it from leaking across the session's lifetime.
 *
 * `liveSessionIdsKey` is the joined live-id string — a stable dependency so the
 * mirror effect doesn't re-run every render (a fresh array would).
 */
export const useFreshSessionIds = (
	liveSessionIdsKey: string,
): FreshSessionIds => {
	const [freshSessionIds, setFreshSessionIds] = useState<ReadonlySet<string>>(
		new Set(),
	)

	const markFresh = (sessionId: string): void => {
		setFreshSessionIds(previous => new Set(previous).add(sessionId))
	}

	const clearFresh = (sessionId: string): void => {
		setFreshSessionIds(previous => {
			if (!previous.has(sessionId)) return previous
			const next = new Set(previous)
			next.delete(sessionId)
			return next
		})
	}

	useEffect(() => {
		const live = new Set(
			liveSessionIdsKey === '' ? [] : liveSessionIdsKey.split('\n'),
		)
		setFreshSessionIds(previous => {
			let changed = false
			const next = new Set<string>()
			for (const id of previous) {
				if (live.has(id)) next.add(id)
				else changed = true
			}
			return changed ? next : previous
		})
	}, [liveSessionIdsKey])

	return { freshSessionIds, markFresh, clearFresh }
}
