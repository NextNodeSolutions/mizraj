import { useEffect, useState } from 'react'

/**
 * The current epoch ms, refreshed every `intervalMs` — one timer per caller,
 * meant to be held once per screen and passed down so relative-time labels
 * ("4m") tick without each card owning a clock.
 */
export const useNow = (intervalMs: number): number => {
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs)
		return () => clearInterval(timer)
	}, [intervalMs])

	return now
}
