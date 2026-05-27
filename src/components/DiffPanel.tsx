import { PatchDiff } from '@pierre/diffs/react'

import type { DiffView } from '../lib/useDiff'
import { useDiff } from '../lib/useDiff'

type Props = {
	sessionId: string
	view: DiffView
}

const DiffPanel = ({ sessionId, view }: Props): React.JSX.Element => {
	const state = useDiff(sessionId, view)

	if (state.status === 'loading') {
		return (
			<p
				className="diff-panel__placeholder"
				role="status"
				aria-live="polite"
			>
				Loading diff…
			</p>
		)
	}
	if (state.status === 'error') {
		return (
			<p
				className="diff-panel__placeholder diff-panel__placeholder--error"
				role="alert"
			>
				Diff unavailable: {state.message}
			</p>
		)
	}
	if (state.patch.trim() === '') {
		return (
			<p className="diff-panel__placeholder" role="status">
				No changes.
			</p>
		)
	}
	return (
		<div className="diff-panel__container">
			<PatchDiff patch={state.patch} />
		</div>
	)
}

export default DiffPanel
