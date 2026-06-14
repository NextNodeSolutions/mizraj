import { useEffect, useState } from 'react'

/**
 * The current epoch ms, refreshed every `intervalMs` — one timer per caller.
 * Hold it once per screen and pass the value down to tick many relative-time
 * labels ("4m") off a single clock, or call it per leaf (e.g. SessionAgeLabel)
 * to confine each tick's re-render to that leaf. Both are valid; the caller
 * picks the trade-off.
 */
export const useNow = (intervalMs: number): number => {
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | null = null

		// Only burn a timer while the window is visible; a hidden window has no
		// labels to refresh. On re-show, tick once to resync the clock that
		// drifted while paused, then resume ticking.
		const start = (): void => {
			if (timer !== null) return
			timer = setInterval(() => setNow(Date.now()), intervalMs)
		}
		const stop = (): void => {
			if (timer === null) return
			clearInterval(timer)
			timer = null
		}
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'hidden') {
				stop()
				return
			}
			setNow(Date.now())
			start()
		}

		if (document.visibilityState !== 'hidden') start()
		document.addEventListener('visibilitychange', onVisibilityChange)
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange)
			stop()
		}
	}, [intervalMs])

	return now
}
