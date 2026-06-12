import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'

import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'
import type { DiffStyle } from '@/shared/useLayoutToggle'

import type { ReviewFile } from './reviewFiles'
import { CHANGE_BADGE } from './reviewFiles'
import { ViewedCheck } from './ViewedCheck'

type Props = {
	file: ReviewFile
	meta: FileDiffMetadata
	diffStyle: DiffStyle
}

/**
 * The center panel: our own sub-header (badge, path, viewed toggle) over the
 * @pierre/diffs renderer — the library header is disabled in its favor.
 */
export const ReviewDiffPane = ({
	file,
	meta,
	diffStyle,
}: Props): React.JSX.Element => (
	<section className="panel review__diff" aria-label="File diff">
		<div className="review__diff-head">
			<span className="review-tree__badge" data-change={file.change}>
				{CHANGE_BADGE[file.change]}
			</span>
			<span className="review__diff-path">{file.path}</span>
			<ViewedCheck
				path={file.path}
				label="Viewed"
				className="review__viewed-label"
			/>
		</div>
		<div className="review__diff-body">
			{/* Keyed remount replays the riseIn entrance on file or style
			    switch — the library's internal DOM is left untouched. */}
			<div
				className="review__diff-file"
				key={`${file.path}:${diffStyle}`}
			>
				<FileDiff
					fileDiff={meta}
					options={{
						diffStyle,
						// TODO: ghostty-driven shiki theme — the catppuccin
						// pair stays until one exists (see shiki-nextnode.ts).
						theme: NEXTNODE_DIFF_THEME,
						disableFileHeader: true,
						hunkSeparators: 'line-info',
						lineHoverHighlight: 'line',
					}}
				/>
			</div>
		</div>
	</section>
)
