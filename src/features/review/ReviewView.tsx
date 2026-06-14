import type { FileDiffMetadata } from '@pierre/diffs'
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'

import { parseReviewFile, useLocationSearch } from '@/app/router'
import { useDiff } from '@/features/diff/useDiff'
import { usePatchFiles } from '@/features/diff/usePatchFiles'
import { pushToast } from '@/shared/toasts'
import { useLayoutToggle } from '@/shared/useLayoutToggle'

import type { ReviewMessage, ReviewRef } from './agentConversation'
import { useConversation } from './agentConversation'
import {
	anchorIsStale,
	composeContextFor,
	resolveFile,
	useSelectedAnnotations,
} from './reviewAnchors'
import type { ReviewAnnotation } from './ReviewDiffPane'
import { ReviewDiffPane } from './ReviewDiffPane'
import type { ReviewFile } from './reviewFiles'
import { diffTotals, reviewFilesFromParsed } from './reviewFiles'
import { ReviewHeader } from './ReviewHeader'
import { ReviewRail } from './ReviewRail'
import { ReviewTree } from './ReviewTree'
import { useFileKeyboardNav } from './useFileKeyboardNav'

type Props = {
	activeProjectPath: string | null
}

type PlaceholderProps = {
	children: React.ReactNode
}

const ReviewPlaceholder = ({
	children,
}: PlaceholderProps): React.JSX.Element => (
	<section className="review review--empty" aria-label="Diff review">
		<p>{children}</p>
	</section>
)

type DiffTarget = {
	shownFile: ReviewFile | null
	shownMeta: FileDiffMetadata | null
	shownAnnotations: Array<ReviewAnnotation>
	shownPath: string | null
}

// What the diff pane renders trails the selection by a deferred value: a click
// updates the tree highlight urgently while the heavy in-place re-tokenize
// (FileDiff's pre-paint layout effect) runs in a low-priority render, so the
// click never blocks on a large file. shownFile/Meta/Annotations all derive
// from the SAME deferred path, so the pane is never internally inconsistent.
const useDeferredDiffTarget = (
	files: ReadonlyArray<ReviewFile>,
	parsedFiles: ReadonlyArray<FileDiffMetadata>,
	selectedPath: string | null,
	thread: ReadonlyArray<ReviewMessage>,
): DiffTarget => {
	const deferredPath = useDeferredValue(selectedPath)
	const shownFile = resolveFile(files, deferredPath)
	const shownMeta =
		parsedFiles.find(file => file.name === shownFile?.path) ?? null
	const shownAnnotations = useSelectedAnnotations(thread, shownMeta)
	return {
		shownFile,
		shownMeta,
		shownAnnotations,
		shownPath: shownFile?.path ?? null,
	}
}

export const ReviewView = ({ activeProjectPath }: Props): React.JSX.Element => {
	const { state } = useDiff(activeProjectPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	const parsedFiles = usePatchFiles(patch)
	const files = useMemo(
		() => reviewFilesFromParsed(parsedFiles),
		[parsedFiles],
	)
	const search = useLocationSearch()
	const requestedFile = parseReviewFile(search)
	const [selectedPath, setSelectedPath] = useState<string | null>(
		requestedFile,
	)
	// A "+ comment" click narrows the composer to one line; it only applies
	// while its file stays selected, so switching files falls back to a
	// file-level context without an effect.
	const [commentAnchor, setCommentAnchor] = useState<ReviewRef | null>(null)
	// Cockpit deep links (reviewHref(path)) re-target the selection on every
	// search change — the render-time adjust keeps it effect-free, and a path
	// missing from the parsed set simply falls back to the first file below.
	const [appliedSearch, setAppliedSearch] = useState(search)
	if (search !== appliedSearch) {
		setAppliedSearch(search)
		if (requestedFile !== null) {
			setSelectedPath(requestedFile)
			setCommentAnchor(null)
		}
	}
	// Clear an armed anchor the moment a reload makes it stale (file gone, or
	// its line reshaped away) so the composer never paints a vanished line.
	// Render-time adjust over an effect: it converges in one pass.
	if (commentAnchor !== null && anchorIsStale(commentAnchor, parsedFiles)) {
		setCommentAnchor(null)
	}
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()
	const composeRef = useRef<HTMLTextAreaElement>(null)
	const thread = useConversation(activeProjectPath)

	// Tree highlight follows the click instantly (urgent); the diff pane trails
	// a deferred copy so the heavy render never blocks the click's paint.
	const selected = resolveFile(files, selectedPath)
	const activePath = selected?.path ?? null
	const { shownFile, shownMeta, shownAnnotations, shownPath } =
		useDeferredDiffTarget(files, parsedFiles, selectedPath, thread)
	const totals = diffTotals(files)
	// Compose context and any armed line comment track the file the diff
	// actually shows (deferred), staying consistent with the visible gutter.
	const composeContext = composeContextFor(shownFile, commentAnchor)

	// Stable identities so memo(ReviewDiffPane) holds: unrelated re-renders
	// (composer typing, toasts, conversation refetch) no longer push fresh
	// callbacks into the persistent FileDiff instance.
	const selectFile = useCallback((path: string): void => {
		setSelectedPath(path)
		setCommentAnchor(null)
	}, [])

	const beginLineComment = useCallback(
		(line: number, side: 'additions' | 'deletions'): void => {
			if (shownPath === null) return
			setCommentAnchor({ path: shownPath, line, side })
			composeRef.current?.focus()
			pushToast('Comment the line, then send to agent')
		},
		[shownPath],
	)

	useFileKeyboardNav(files, activePath, selectFile)

	if (state.status === 'idle') {
		return <ReviewPlaceholder>No repository selected.</ReviewPlaceholder>
	}
	if (state.status === 'loading') {
		return <ReviewPlaceholder>Loading diff…</ReviewPlaceholder>
	}
	if (state.status === 'error') {
		return (
			<ReviewPlaceholder>
				Diff unavailable: {state.message}
			</ReviewPlaceholder>
		)
	}
	if (files.length === 0) {
		return (
			<ReviewPlaceholder>
				No changes — the working tree is clean.
			</ReviewPlaceholder>
		)
	}

	return (
		<section className="review" aria-label="Diff review">
			<ReviewHeader
				repoPath={activeProjectPath}
				totals={totals}
				layout={layout}
				toggleLayout={toggleLayout}
				onRequestChanges={() => composeRef.current?.focus()}
			/>
			<div className="review__body stagger">
				<ReviewTree
					files={files}
					selectedPath={activePath}
					onSelect={selectFile}
				/>
				{shownFile !== null && shownMeta !== null ? (
					<ReviewDiffPane
						file={shownFile}
						meta={shownMeta}
						diffStyle={diffStyle}
						annotations={shownAnnotations}
						onBeginComment={beginLineComment}
					/>
				) : (
					<section
						className="panel review__diff"
						aria-label="File diff"
					/>
				)}
				<ReviewRail
					repoPath={activeProjectPath}
					totals={totals}
					context={composeContext}
					composeRef={composeRef}
				/>
			</div>
		</section>
	)
}
