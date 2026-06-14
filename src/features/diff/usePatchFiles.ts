import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { useMemo } from 'react'

const DJB2_SEED = 5381
const DJB2_MULTIPLIER = 33
const BASE36 = 36

// A content-derived prefix (djb2) so @pierre/diffs stamps each file with a
// cacheKey (`prefix-patchIndex-fileIndex`). Without it the worker pool's LRU is
// bypassed and every re-open re-tokenizes from scratch; with it, re-opening a
// file returns the cached highlight instantly. The prefix changes with the
// patch content, so an edited file never serves a stale highlight.
export const hashPatch = (patch: string): string => {
	let hash = DJB2_SEED
	for (let i = 0; i < patch.length; i += 1) {
		hash = (hash * DJB2_MULTIPLIER + patch.charCodeAt(i)) | 0
	}
	return (hash >>> 0).toString(BASE36)
}

/**
 * Parse a working-tree patch into per-file diff metadata, memoized on the patch
 * string and cache-keyed for the highlight worker pool. The single home for the
 * parse both the cockpit diff dock (DiffPanel) and the review screen use.
 */
export const usePatchFiles = (
	patch: string | null,
): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch, hashPatch(patch)).flatMap(
						parsed => parsed.files,
					),
		[patch],
	)
