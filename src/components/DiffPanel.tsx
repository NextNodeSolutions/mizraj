import { useDiff } from '../lib/useDiff'
import { useLayoutToggle } from '../lib/useLayoutToggle'

import DiffPanelBody from './DiffPanelBody'
import DiffPanelToolbar from './DiffPanelToolbar'

type Props = {
	onClose?: () => void
}

const DiffPanel = ({ onClose }: Props): React.JSX.Element => {
	const state = useDiff()
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()

	return (
		<div className="diff-panel">
			<DiffPanelToolbar
				layout={layout}
				onToggle={toggleLayout}
				onClose={onClose}
			/>
			<DiffPanelBody state={state} diffStyle={diffStyle} />
		</div>
	)
}

export default DiffPanel
