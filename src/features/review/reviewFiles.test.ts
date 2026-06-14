import { parsePatchFiles } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'

import {
	diffLineIsPresent,
	diffTotals,
	reviewFilesFromPatch,
} from './reviewFiles'

const PATCH = [
	'diff --git a/src/api/limiter.ts b/src/api/limiter.ts',
	'new file mode 100644',
	'index 0000000..3f1e2d4',
	'--- /dev/null',
	'+++ b/src/api/limiter.ts',
	'@@ -0,0 +1,3 @@',
	'+export const rateLimit = (opts) => (req, res, next) => {',
	'+  next()',
	'+}',
	'diff --git a/src/api/handler.ts b/src/api/handler.ts',
	'index 1111111..2222222 100644',
	'--- a/src/api/handler.ts',
	'+++ b/src/api/handler.ts',
	'@@ -8,3 +8,4 @@',
	' import { router } from "./router"',
	'-router.post("/send", send)',
	'+router.use(rateLimit({ rpm: 60 }))',
	'+router.post("/send", send)',
	' export { router }',
	'diff --git a/src/api/legacy.ts b/src/api/legacy.ts',
	'deleted file mode 100644',
	'index 3333333..0000000',
	'--- a/src/api/legacy.ts',
	'+++ /dev/null',
	'@@ -1,2 +0,0 @@',
	'-export const legacy = true',
	'-export default legacy',
	'',
].join('\n')

describe('reviewFilesFromPatch', () => {
	it('maps each patch file to its path, change kind and line stats', () => {
		const files = reviewFilesFromPatch(PATCH)

		expect(files).toEqual([
			{
				path: 'src/api/limiter.ts',
				change: 'added',
				additions: 3,
				deletions: 0,
			},
			{
				path: 'src/api/handler.ts',
				change: 'modified',
				additions: 2,
				deletions: 1,
			},
			{
				path: 'src/api/legacy.ts',
				change: 'deleted',
				additions: 0,
				deletions: 2,
			},
		])
	})

	it('returns no files for an empty patch', () => {
		expect(reviewFilesFromPatch('')).toEqual([])
	})
})

// A pure rename (100% similarity, no hunks) and a renamed-and-edited file at a
// nested destination path. Both must surface as change:'renamed'.
const RENAME_PATCH = [
	'diff --git a/src/old/util.ts b/src/new/util.ts',
	'similarity index 100%',
	'rename from src/old/util.ts',
	'rename to src/new/util.ts',
	'diff --git a/src/components/Old.tsx b/src/components/nested/New.tsx',
	'similarity index 72%',
	'rename from src/components/Old.tsx',
	'rename to src/components/nested/New.tsx',
	'index 1111111..2222222 100644',
	'--- a/src/components/Old.tsx',
	'+++ b/src/components/nested/New.tsx',
	'@@ -1,3 +1,4 @@',
	' import React from "react"',
	'-export const Old = () => null',
	'+export const New = () => null',
	'+export default New',
	' // eof',
	'',
].join('\n')

describe('reviewFilesFromPatch — renames', () => {
	it('marks a pure rename renamed with no line changes', () => {
		const files = reviewFilesFromPatch(RENAME_PATCH)

		expect(files[0]).toEqual({
			path: 'src/new/util.ts',
			change: 'renamed',
			additions: 0,
			deletions: 0,
		})
	})

	it('marks a renamed-and-edited file at a nested path renamed with its line stats', () => {
		const files = reviewFilesFromPatch(RENAME_PATCH)

		expect(files[1]).toEqual({
			path: 'src/components/nested/New.tsx',
			change: 'renamed',
			additions: 2,
			deletions: 1,
		})
	})
})

describe('diffLineIsPresent', () => {
	const meta = parsePatchFiles(PATCH)
		.flatMap(parsed => parsed.files)
		.find(file => file.name === 'src/api/handler.ts')

	it('reports a line inside a hunk as present', () => {
		expect(meta).toBeDefined()
		if (meta === undefined) return
		// The handler hunk's addition side covers lines 8..11.
		expect(diffLineIsPresent(meta, 9, 'additions')).toBe(true)
	})

	it('reports a line outside every hunk as absent', () => {
		expect(meta).toBeDefined()
		if (meta === undefined) return
		expect(diffLineIsPresent(meta, 999, 'additions')).toBe(false)
	})
})

describe('diffTotals', () => {
	it('aggregates files, additions and deletions', () => {
		const totals = diffTotals(reviewFilesFromPatch(PATCH))

		expect(totals).toEqual({ files: 3, additions: 5, deletions: 3 })
	})
})
