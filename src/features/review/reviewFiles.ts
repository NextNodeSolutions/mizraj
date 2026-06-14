import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'

export type ReviewFileChange = 'added' | 'modified' | 'deleted' | 'renamed'

export type ReviewFile = {
	path: string
	change: ReviewFileChange
	additions: number
	deletions: number
}

export type DiffTotals = {
	files: number
	additions: number
	deletions: number
}

/** The badge letter a change kind wears in the tree and the diff head. */
export const CHANGE_BADGE: Readonly<Record<ReviewFileChange, string>> = {
	added: 'A',
	modified: 'M',
	deleted: 'D',
	renamed: 'R',
}

const CHANGE_BY_PATCH_TYPE: Readonly<Record<string, ReviewFileChange>> = {
	new: 'added',
	deleted: 'deleted',
	change: 'modified',
	'rename-pure': 'renamed',
	'rename-changed': 'renamed',
}

/**
 * Project parsed patch files onto the review tree's model: one entry per
 * file with its change kind and +/− line counts. Callers that already
 * parsed the patch for rendering pass the same metadata here, so the tree
 * and the diff pane can never disagree.
 */
export const reviewFilesFromParsed = (
	files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<ReviewFile> =>
	files.map(file => ({
		path: file.name,
		change: CHANGE_BY_PATCH_TYPE[file.type] ?? 'modified',
		additions: file.hunks.reduce(
			(sum, hunk) => sum + hunk.additionLines,
			0,
		),
		deletions: file.hunks.reduce(
			(sum, hunk) => sum + hunk.deletionLines,
			0,
		),
	}))

export const reviewFilesFromPatch = (
	patch: string,
): ReadonlyArray<ReviewFile> =>
	reviewFilesFromParsed(
		parsePatchFiles(patch).flatMap(parsed => parsed.files),
	)

/**
 * True when `line` on `side` falls inside one of the file's hunks — i.e. that
 * line is still present in the freshly parsed diff. A hunk renders its new
 * side over `[additionStart, additionStart + additionCount)` and its old side
 * over `[deletionStart, deletionStart + deletionCount)`; a line outside every
 * hunk's matching range no longer maps to a shown line.
 *
 * Line comments anchor to an absolute line captured at send time, so they are
 * only valid while that line still appears in the diff: when a reload (window
 * focus, agent edit) reshapes the hunks, an anchor that no longer lands on a
 * present line is stale and must be dropped rather than pinned to a shifted
 * neighbour.
 */
export const diffLineIsPresent = (
	meta: FileDiffMetadata,
	line: number,
	side: 'additions' | 'deletions',
): boolean =>
	meta.hunks.some(hunk => {
		const start =
			side === 'additions' ? hunk.additionStart : hunk.deletionStart
		const count =
			side === 'additions' ? hunk.additionCount : hunk.deletionCount
		return line >= start && line < start + count
	})

export const diffTotals = (files: ReadonlyArray<ReviewFile>): DiffTotals => ({
	files: files.length,
	additions: files.reduce((sum, file) => sum + file.additions, 0),
	deletions: files.reduce((sum, file) => sum + file.deletions, 0),
})
