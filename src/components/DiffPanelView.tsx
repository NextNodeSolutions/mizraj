import { PatchDiff } from '@pierre/diffs/react'

import type { DiffStyle } from '../lib/useLayoutToggle'
import { NEXTNODE_DIFF_THEME } from '../theme/shiki-nextnode'

type Props = {
	patch: string
	diffStyle: DiffStyle
}

const DiffPanelView = ({ patch, diffStyle }: Props): React.JSX.Element => (
	<div className="diff-panel__container">
		<PatchDiff
			patch={patch}
			options={{ diffStyle, theme: NEXTNODE_DIFF_THEME }}
		/>
	</div>
)

export default DiffPanelView
