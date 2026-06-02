import { useLayoutToggle } from '@/shared/useLayoutToggle'

import { DiffPanelBody } from './DiffPanelBody'
import { DiffPanelToolbar } from './DiffPanelToolbar'
import { useDiff } from './useDiff'

type Props = {
	onClose?: () => void
}

export const DiffPanel = ({ onClose }: Props): React.JSX.Element => {
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
