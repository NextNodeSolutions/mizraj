import type { ResourceState } from '@/shared/repoResource'
import type { DiffStyle } from '@/shared/useLayoutToggle'

import { DiffPanelPlaceholder } from './DiffPanelPlaceholder'
import { DiffPanelView } from './DiffPanelView'

type Props = {
	state: ResourceState<{ patch: string }>
	diffStyle: DiffStyle
}

export const DiffPanelBody = ({
	state,
	diffStyle,
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
	return <DiffPanelView patch={state.data.patch} diffStyle={diffStyle} />
}
