import type { DiffLoadState } from '../lib/useDiff'
import type { DiffStyle } from '../lib/useLayoutToggle'
import DiffPanelPlaceholder from './DiffPanelPlaceholder'
import DiffPanelView from './DiffPanelView'

type Props = {
	state: DiffLoadState
	diffStyle: DiffStyle
}

const DiffPanelBody = ({ state, diffStyle }: Props): React.JSX.Element => {
	if (state.status === 'loading') {
		return <DiffPanelPlaceholder tone="loading">Loading diff…</DiffPanelPlaceholder>
	}
	if (state.status === 'error') {
		return (
			<DiffPanelPlaceholder tone="error">
				Diff unavailable: {state.message}
			</DiffPanelPlaceholder>
		)
	}
	if (state.patch.trim() === '') {
		return <DiffPanelPlaceholder tone="empty">No changes.</DiffPanelPlaceholder>
	}
	return <DiffPanelView patch={state.patch} diffStyle={diffStyle} />
}

export default DiffPanelBody
