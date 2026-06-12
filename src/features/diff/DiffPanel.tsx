import { useLayoutToggle } from '@/shared/useLayoutToggle'

import { DiffPanelBody } from './DiffPanelBody'
import { DiffPanelToolbar } from './DiffPanelToolbar'
import { useDiff } from './useDiff'

type Props = {
	repoPath: string | null
	onClose?: () => void
	/** Extra toolbar actions — e.g. the cockpit's "Open review" link. */
	children?: React.ReactNode
}

export const DiffPanel = ({
	repoPath,
	onClose,
	children,
}: Props): React.JSX.Element => {
	const { state } = useDiff(repoPath)
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()

	return (
		<div className="diff-panel">
			<DiffPanelToolbar
				layout={layout}
				onToggle={toggleLayout}
				onClose={onClose}
			>
				{children}
			</DiffPanelToolbar>
			<DiffPanelBody state={state} diffStyle={diffStyle} />
		</div>
	)
}
