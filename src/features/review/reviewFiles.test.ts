import { describe, expect, it } from 'vitest'

import { diffTotals, reviewFilesFromPatch } from './reviewFiles'

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

describe('diffTotals', () => {
	it('aggregates files, additions and deletions', () => {
		const totals = diffTotals(reviewFilesFromPatch(PATCH))

		expect(totals).toEqual({ files: 3, additions: 5, deletions: 3 })
	})
})
