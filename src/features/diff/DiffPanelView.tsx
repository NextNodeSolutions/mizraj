import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useMemo } from 'react'

import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'
import type { DiffStyle } from '@/shared/useLayoutToggle'

type Props = {
	patch: string
	diffStyle: DiffStyle
}

export const DiffPanelView = ({
	patch,
	diffStyle,
}: Props): React.JSX.Element => {
	const files = useMemo(
		() => parsePatchFiles(patch).flatMap(parsed => parsed.files),
		[patch],
	)

	return (
		<div className="diff-panel__container">
			{files.map(file => (
				<FileDiff
					key={file.name}
					fileDiff={file}
					options={{ diffStyle, theme: NEXTNODE_DIFF_THEME }}
				/>
			))}
		</div>
	)
}
