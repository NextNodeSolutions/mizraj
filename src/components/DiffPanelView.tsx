import { PatchDiff } from '@pierre/diffs/react'

import type { DiffStyle } from '../lib/useLayoutToggle'

type Props = {
	patch: string
	diffStyle: DiffStyle
}

const DiffPanelView = ({ patch, diffStyle }: Props): React.JSX.Element => (
	<div className="diff-panel__container">
		<PatchDiff patch={patch} options={{ diffStyle }} />
	</div>
)

export default DiffPanelView
