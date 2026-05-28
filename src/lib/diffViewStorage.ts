import type { DiffView } from './useDiff'

const STORAGE_PREFIX = 'diff-panel:view:'

export const DEFAULT_DIFF_VIEW: DiffView = 'session'

const storageKeyFor = (sessionId: string): string =>
	`${STORAGE_PREFIX}${sessionId}`

const isDiffView = (value: string): value is DiffView =>
	value === 'session' || value === 'working_tree' || value === 'head_base'

export const readStoredDiffView = (sessionId: string): DiffView => {
	if (typeof window === 'undefined') return DEFAULT_DIFF_VIEW
	const raw = window.localStorage.getItem(storageKeyFor(sessionId))
	if (raw === null) return DEFAULT_DIFF_VIEW
	return isDiffView(raw) ? raw : DEFAULT_DIFF_VIEW
}

export const writeStoredDiffView = (sessionId: string, view: DiffView): void => {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(storageKeyFor(sessionId), view)
}
