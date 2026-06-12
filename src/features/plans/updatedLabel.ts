import { formatSessionAge } from '@/features/missionControl/sessionAge'

const MS_PER_SECOND = 1000

/**
 * "updated 2h ago" — how long ago a plan/interview file changed, from its
 * unix-seconds mtime (list_plans reports seconds; the age formatter wants ms).
 */
export const updatedLabel = (nowMs: number, mtimeSeconds: number): string =>
	`updated ${formatSessionAge(nowMs, mtimeSeconds * MS_PER_SECOND)} ago`
