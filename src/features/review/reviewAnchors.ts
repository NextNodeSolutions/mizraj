import type { FileDiffMetadata } from '@pierre/diffs'
import { useMemo } from 'react'

import type { ReviewMessage, ReviewRef } from './agentConversation'
import type { ReviewAnnotation } from './ReviewDiffPane'
import type { ReviewFile } from './reviewFiles'
import { diffLineIsPresent } from './reviewFiles'

// First match by path, else the first file. The tree highlight (urgent) and the
// diff pane (deferred) resolve their file the same way from different paths.
export const resolveFile = (
	files: ReadonlyArray<ReviewFile>,
	path: string | null,
): ReviewFile | null =>
	files.find(file => file.path === path) ?? files[0] ?? null

// An armed anchor is stale once it no longer maps to shown content: its file
// left the parsed patch, or a reload (agent edit, window focus) reshaped the
// hunks so its line is gone. The composer must then drop it rather than pin the
// chip / pasted `[path:line]` prefix to a vanished line — the same
// line-presence test the diff annotations apply (diffLineIsPresent).
export const anchorIsStale = (
	anchor: ReviewRef,
	parsedFiles: ReadonlyArray<FileDiffMetadata>,
): boolean => {
	const meta = parsedFiles.find(file => file.name === anchor.path) ?? null
	if (meta === null) return true
	return (
		anchor.line !== null &&
		!diffLineIsPresent(meta, anchor.line, anchor.side)
	)
}

// Where the composer anchors: the armed line while its file stays selected,
// else the selected file — so switching files resets the context by itself.
export const composeContextFor = (
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
export const useSelectedAnnotations = (
	thread: ReadonlyArray<ReviewMessage>,
	meta: FileDiffMetadata | null,
): Array<ReviewAnnotation> =>
	useMemo(() => annotationsFor(thread, meta), [thread, meta])
