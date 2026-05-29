import { useDiff } from '../lib/useDiff'
import { useDiffView } from '../lib/useDiffView'
import { useLayoutToggle } from '../lib/useLayoutToggle'

import DiffPanelBody from './DiffPanelBody'
import DiffPanelToolbar from './DiffPanelToolbar'

type Props = {
	sessionId: string
	onClose?: () => void
}

const DiffPanel = ({ sessionId, onClose }: Props): React.JSX.Element => {
	const { view, setView } = useDiffView(sessionId)
	const state = useDiff(sessionId, view)
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()

	return (
		<div className="diff-panel">
			<DiffPanelToolbar
				view={view}
				onViewChange={setView}
				layout={layout}
				onToggle={toggleLayout}
				onClose={onClose}
			/>
			<DiffPanelBody state={state} diffStyle={diffStyle} />
		</div>
	)
}

export default DiffPanel
