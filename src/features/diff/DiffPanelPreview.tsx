import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'

import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'

type Props = {
	fileDiff: FileDiffMetadata
}

/**
 * The unified-diff preview of one file: the @pierre FileDiff wired with the
 * app's shiki theme. The caller keys it by file name so switching files
 * remounts cleanly. Mirrors DiffPanelFiles on the list side of the dock.
 */
export const DiffPanelPreview = ({ fileDiff }: Props): React.JSX.Element => (
	<FileDiff
		fileDiff={fileDiff}
		options={{ diffStyle: 'unified', theme: NEXTNODE_DIFF_THEME }}
	/>
)
