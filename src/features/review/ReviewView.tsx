import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { useMemo, useRef, useState } from 'react'

import { parseReviewFile, useLocationSearch } from '@/app/router'
import { useDiff } from '@/features/diff/useDiff'
import { pushToast } from '@/shared/toasts'
import { useLayoutToggle } from '@/shared/useLayoutToggle'

import type { ReviewMessage, ReviewRef } from './agentConversation'
import { useConversation } from './agentConversation'
import type { ReviewAnnotation } from './ReviewDiffPane'
import { ReviewDiffPane } from './ReviewDiffPane'
import type { ReviewFile } from './reviewFiles'
import { diffTotals, reviewFilesFromParsed } from './reviewFiles'
import { ReviewHeader } from './ReviewHeader'
import { ReviewRail } from './ReviewRail'
import { ReviewTree } from './ReviewTree'

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

const usePatchFiles = (patch: string | null): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch).flatMap(parsed => parsed.files),
		[patch],
	)

// Where the composer anchors: the armed line while its file stays selected,
// else the selected file — so switching files resets the context by itself.
const composeContextFor = (
	selected: ReviewFile | null,
	anchor: ReviewRef | null,
): ReviewRef | null => {
	if (selected === null) return null
	if (anchor !== null && anchor.path === selected.path) return anchor
	return { path: selected.path, line: null, side: null }
}

// Line-anchored remarks of one file, as the diff renderer's annotations.
// TODO: persist line comments (backend has no review-comment storage; atom
// state dies with the window).
const annotationsFor = (
	thread: ReadonlyArray<ReviewMessage>,
	path: string | null,
): Array<ReviewAnnotation> =>
	thread.flatMap(message =>
		message.ref !== null &&
		message.ref.path === path &&
		message.ref.line !== null
			? [
					{
						side: message.ref.side ?? 'additions',
						lineNumber: message.ref.line,
						metadata: message,
					},
				]
			: [],
	)

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
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()
	const composeRef = useRef<HTMLTextAreaElement>(null)
	const thread = useConversation(activeProjectPath)

	const selected =
		files.find(file => file.path === selectedPath) ?? files[0] ?? null
	const selectedMeta =
		parsedFiles.find(file => file.name === selected?.path) ?? null
	const totals = diffTotals(files)
	const composeContext = composeContextFor(selected, commentAnchor)

	const selectFile = (path: string): void => {
		setSelectedPath(path)
		setCommentAnchor(null)
	}

	const beginLineComment = (
		line: number,
		side: 'additions' | 'deletions' | null,
	): void => {
		if (selected === null) return
		setCommentAnchor({ path: selected.path, line, side })
		composeRef.current?.focus()
		pushToast('Comment the line, then send to agent')
	}

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
					selectedPath={selected?.path ?? null}
					onSelect={selectFile}
				/>
				{selected !== null && selectedMeta !== null ? (
					<ReviewDiffPane
						file={selected}
						meta={selectedMeta}
						diffStyle={diffStyle}
						annotations={annotationsFor(thread, selected.path)}
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
