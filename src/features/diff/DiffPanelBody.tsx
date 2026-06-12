import type { ResourceState } from '@/shared/repoResource'

import { DiffPanelPlaceholder } from './DiffPanelPlaceholder'

type Props = {
	state: ResourceState<{ patch: string }>
	/** What the dock shows once a non-empty patch is ready. */
	children: React.ReactNode
}

/**
 * Maps the diff resource onto the dock's placeholder states and only lets
 * `children` (file list + preview) through for a ready, non-empty patch.
 */
export const DiffPanelBody = ({
	state,
	children,
}: Props): React.JSX.Element => {
	if (state.status === 'idle') {
		return (
			<DiffPanelPlaceholder tone="empty">
				No repository selected.
			</DiffPanelPlaceholder>
		)
	}
	if (state.status === 'loading') {
		return (
			<DiffPanelPlaceholder tone="loading">
				Loading diff…
			</DiffPanelPlaceholder>
		)
	}
	if (state.status === 'error') {
		return (
			<DiffPanelPlaceholder tone="error">
				Diff unavailable: {state.message}
			</DiffPanelPlaceholder>
		)
	}
	if (state.data.patch.trim() === '') {
		return (
			<DiffPanelPlaceholder tone="empty">
				No changes.
			</DiffPanelPlaceholder>
		)
	}
	return <>{children}</>
}
