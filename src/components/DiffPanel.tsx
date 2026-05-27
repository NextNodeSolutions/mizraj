import type { DiffView } from '../lib/useDiff'
import { useDiff } from '../lib/useDiff'
import { useLayoutToggle } from '../lib/useLayoutToggle'
import DiffPanelBody from './DiffPanelBody'
import DiffPanelToolbar from './DiffPanelToolbar'

type Props = {
	sessionId: string
	view: DiffView
}

const DiffPanel = ({ sessionId, view }: Props): React.JSX.Element => {
	const state = useDiff(sessionId, view)
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()

	return (
		<div className="diff-panel">
			<DiffPanelToolbar layout={layout} onToggle={toggleLayout} />
			<DiffPanelBody state={state} diffStyle={diffStyle} />
		</div>
	)
}

export default DiffPanel
