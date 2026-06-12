const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const SECOND_MS = MS_PER_SECOND
const MINUTE_MS = SECONDS_PER_MINUTE * SECOND_MS
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS
const DAY_MS = HOURS_PER_DAY * HOUR_MS

/**
 * Compact "how long has this agent been at it" label: `12s`, `4m`, `2h`,
 * `3d`. Truncates instead of rounding so a card never claims more time than
 * elapsed, and clamps negative skew to `0s`.
 */
export const formatSessionAge = (
	nowMs: number,
	startedAtMs: number,
): string => {
	const elapsed = Math.max(0, nowMs - startedAtMs)
	if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)}s`
	if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`
	if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`
	return `${Math.floor(elapsed / DAY_MS)}d`
}
