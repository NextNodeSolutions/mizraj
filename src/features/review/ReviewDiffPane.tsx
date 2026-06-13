import type { DiffLineAnnotation, FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'

import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'
import type { DiffStyle } from '@/shared/useLayoutToggle'

import type { ReviewMessage } from './agentConversation'
import type { ReviewFile } from './reviewFiles'
import { CHANGE_BADGE } from './reviewFiles'
import { ViewedCheck } from './ViewedCheck'

/** A thread message pinned to one diff line, as the renderer consumes it. */
export type ReviewAnnotation = DiffLineAnnotation<ReviewMessage>

type InlineCommentProps = {
	message: ReviewMessage
}

const InlineComment = ({ message }: InlineCommentProps): React.JSX.Element => (
	<div className="review__inline-cmt">
		<div className="who">
			You
			{message.ref !== null &&
				message.ref.line !== null &&
				` · line ${message.ref.line}`}
		</div>
		<div className="txt">{message.text}</div>
		<span className="chip2">↻ sent to agent</span>
	</div>
)

type Props = {
	file: ReviewFile
	meta: FileDiffMetadata
	diffStyle: DiffStyle
	annotations: Array<ReviewAnnotation>
	onBeginComment: (
		line: number,
		side: 'additions' | 'deletions' | null,
	) => void
}

/**
 * The center panel: our own sub-header (badge, path, viewed toggle) over the
 * @pierre/diffs renderer — the library header is disabled in its favor.
 */
export const ReviewDiffPane = ({
	file,
	meta,
	diffStyle,
	annotations,
	onBeginComment,
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
						enableGutterUtility: true,
					}}
					lineAnnotations={annotations}
					renderAnnotation={annotation => (
						<InlineComment message={annotation.metadata} />
					)}
					renderGutterUtility={getHoveredLine => (
						<button
							type="button"
							className="review__cmt-add"
							onClick={() => {
								const hovered = getHoveredLine()
								if (hovered === undefined) return
								onBeginComment(hovered.lineNumber, hovered.side)
							}}
						>
							+ comment
						</button>
					)}
				/>
			</div>
		</div>
	</section>
)
