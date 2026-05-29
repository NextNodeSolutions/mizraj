import { useCallback, useState } from 'react'

import { readStoredDiffView, writeStoredDiffView } from './diffViewStorage'
import type { DiffView } from './useDiff'

type UseDiffView = {
	view: DiffView
	setView: (next: DiffView) => void
}

export const useDiffView = (sessionId: string): UseDiffView => {
	const [view, setViewState] = useState<DiffView>(() =>
		readStoredDiffView(sessionId),
	)

	const setView = useCallback(
		(next: DiffView): void => {
			setViewState(next)
			writeStoredDiffView(sessionId, next)
		},
		[sessionId],
	)

	return { view, setView }
}
