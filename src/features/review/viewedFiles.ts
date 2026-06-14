import { atom } from 'jotai'

type ViewedMap = Readonly<Record<string, true>>

// Paths the reviewer ticked off. Keyed by path alone: the map outlives diff
// refreshes (an agent iterating doesn't reset your progress) and stale
// entries simply stop counting once the file leaves the diff.
export const viewedFilesAtom = atom<ViewedMap>({})

export const toggleViewedAtom = atom(null, (get, set, path: string) => {
	const viewed = get(viewedFilesAtom)
	if (viewed[path]) {
		const { [path]: _, ...rest } = viewed
		set(viewedFilesAtom, rest)
		return
	}
	set(viewedFilesAtom, { ...viewed, [path]: true })
})

export type ReviewProgress = {
	viewed: number
	total: number
	percent: number
}

const FULL_PERCENT = 100

export const reviewProgress = (
	viewed: ViewedMap,
	paths: ReadonlyArray<string>,
): ReviewProgress => {
	const done = paths.filter(path => viewed[path]).length
	return {
		viewed: done,
		total: paths.length,
		percent:
			paths.length === 0
				? 0
				: Math.round((done / paths.length) * FULL_PERCENT),
	}
}
