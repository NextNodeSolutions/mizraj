import { parsePatchFiles } from '@pierre/diffs'

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

const CHANGE_BY_PATCH_TYPE: Readonly<Record<string, ReviewFileChange>> = {
	new: 'added',
	deleted: 'deleted',
	change: 'modified',
	'rename-pure': 'renamed',
	'rename-changed': 'renamed',
}

/**
 * Flatten a raw unified patch into the review tree's model: one entry per
 * file with its change kind and +/− line counts. Parsing is delegated to
 * `@pierre/diffs` — the same parser that renders the diff — so the tree and
 * the diff pane can never disagree.
 */
export const reviewFilesFromPatch = (
	patch: string,
): ReadonlyArray<ReviewFile> =>
	parsePatchFiles(patch)
		.flatMap(parsed => parsed.files)
		.map(file => ({
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

export const diffTotals = (files: ReadonlyArray<ReviewFile>): DiffTotals => ({
	files: files.length,
	additions: files.reduce((sum, file) => sum + file.additions, 0),
	deletions: files.reduce((sum, file) => sum + file.deletions, 0),
})
