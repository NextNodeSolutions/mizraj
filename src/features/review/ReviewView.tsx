import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { parseReviewFile, useLocationSearch } from '@/app/router'
import { useDiff } from '@/features/diff/useDiff'
import { pushToast } from '@/shared/toasts'
import { useLayoutToggle } from '@/shared/useLayoutToggle'

import type { ReviewMessage, ReviewRef } from './agentConversation'
import { useConversation } from './agentConversation'
import type { ReviewAnnotation } from './ReviewDiffPane'
import { ReviewDiffPane } from './ReviewDiffPane'
import type { ReviewFile } from './reviewFiles'
import {
	diffLineIsPresent,
	diffTotals,
	reviewFilesFromParsed,
} from './reviewFiles'
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

// A content-derived prefix (djb2) so @pierre/diffs stamps each file with a
// cacheKey (`prefix-patchIndex-fileIndex`). Without it the worker pool's LRU is
// bypassed and every re-open re-tokenizes from scratch; with it, re-opening a
// file returns the cached highlight instantly. The prefix changes with the
// patch content, so an edited file never serves a stale highlight.
const DJB2_SEED = 5381
const DJB2_MULTIPLIER = 33
const BASE36 = 36

const hashPatch = (patch: string): string => {
	let hash = DJB2_SEED
	for (let i = 0; i < patch.length; i += 1) {
		hash = (hash * DJB2_MULTIPLIER + patch.charCodeAt(i)) | 0
	}
	return (hash >>> 0).toString(BASE36)
}

const usePatchFiles = (patch: string | null): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch, hashPatch(patch)).flatMap(
						parsed => parsed.files,
					),
		[patch],
	)

// First match by path, else the first file. The tree highlight (urgent) and the
// diff pane (deferred) resolve their file the same way from different paths.
const resolveFile = (
	files: ReadonlyArray<ReviewFile>,
	path: string | null,
): ReviewFile | null =>
	files.find(file => file.path === path) ?? files[0] ?? null

// An armed anchor is stale once it no longer maps to shown content: its file
// left the parsed patch, or a reload (agent edit, window focus) reshaped the
// hunks so its line is gone. The composer must then drop it rather than pin the
// chip / pasted `[path:line]` prefix to a vanished line — the same
// line-presence test the diff annotations apply (diffLineIsPresent).
const anchorIsStale = (
	anchor: ReviewRef,
	parsedFiles: ReadonlyArray<FileDiffMetadata>,
): boolean => {
	const meta = parsedFiles.find(file => file.name === anchor.path) ?? null
	if (meta === null) return true
	return anchor.line !== null && !diffLineIsPresent(meta, anchor.line, anchor.side)
}

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

// Line-anchored remarks of one file, as the diff renderer's annotations. An
// anchor is pinned to the absolute line captured at send time, so it is only
// valid while that line is still present in the freshly parsed diff: when a
// reload (window focus, agent edit) reshapes the file, any anchor that no
// longer lands on a shown line is dropped rather than pinned to a shifted
// neighbour. With ReviewRef coupling line⇔side, a line-anchored ref always
// carries its side — no fallback needed.
// TODO: persist line comments (backend has no review-comment storage; atom
// state dies with the window).
const annotationsFor = (
	thread: ReadonlyArray<ReviewMessage>,
	meta: FileDiffMetadata | null,
): Array<ReviewAnnotation> =>
	meta === null
		? []
		: thread.flatMap(message =>
				message.ref !== null &&
				message.ref.path === meta.name &&
				message.ref.line !== null &&
				diffLineIsPresent(meta, message.ref.line, message.ref.side)
					? [
							{
								side: message.ref.side,
								lineNumber: message.ref.line,
								metadata: message,
							},
						]
					: [],
			)

// Annotations for the shown file, stable across unrelated re-renders (composer
// typing, toasts): a fresh array would make the persistent FileDiff instance
// re-diff its annotations every time the rail re-renders. Keyed on the parsed
// meta so a reload that drops a line re-filters the anchors.
const useSelectedAnnotations = (
	thread: ReadonlyArray<ReviewMessage>,
	meta: FileDiffMetadata | null,
): Array<ReviewAnnotation> =>
	useMemo(() => annotationsFor(thread, meta), [thread, meta])

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

const isTextEntry = (node: Element | null): boolean =>
	node instanceof HTMLElement &&
	(node.tagName === 'TEXTAREA' ||
		node.tagName === 'INPUT' ||
		node.isContentEditable)

// Tab → next changed file, Shift+Tab → previous (wrapping). Suppressed while
// the composer (or any text field) holds focus, so writing a remark keeps Tab's
// normal behavior. Rapid Tab presses ride the same deferred path as clicks.
const useFileKeyboardNav = (
	files: ReadonlyArray<ReviewFile>,
	currentPath: string | null,
	selectFile: (path: string) => void,
): void => {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (
				event.key !== 'Tab' ||
				event.altKey ||
				event.metaKey ||
				event.ctrlKey ||
				files.length === 0 ||
				isTextEntry(document.activeElement)
			) {
				return
			}
			event.preventDefault()
			const current = files.findIndex(file => file.path === currentPath)
			const base = current === -1 ? 0 : current
			const step = event.shiftKey ? -1 : 1
			const target = files[(base + step + files.length) % files.length]
			if (target !== undefined) selectFile(target.path)
		}
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [files, currentPath, selectFile])
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
