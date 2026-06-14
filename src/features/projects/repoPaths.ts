/** Display helpers for repository paths, shared by every repo-listing surface. */

const NO_PROJECT_LABEL = 'no project'

const NO_PROJECT_DIR = '—'

/** The repo's human name — its last path segment. */
export const projectName = (repoPath: string | null): string => {
	if (repoPath === null) return NO_PROJECT_LABEL
	return repoPath.split('/').findLast(segment => segment !== '') ?? repoPath
}

const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+/

/**
 * Display-only path compaction: the home prefix becomes a tilde.
 * POSIX-only by design — the app targets macOS/Linux, so Windows drive paths
 * (`C:\Users\…`) are out of scope for this regex.
 */
export const compactPath = (repoPath: string | null): string =>
	repoPath === null ? NO_PROJECT_DIR : repoPath.replace(HOME_PREFIX, '~')

export const HUES = [
	'blue',
	'mauve',
	'teal',
	'peach',
	'green',
	'sky',
	'pink',
	'yellow',
] as const

export type Hue = (typeof HUES)[number]

const DJB2_SEED = 5381

const DJB2_MULTIPLIER = 33

const djb2 = (value: string): number => {
	let hash = DJB2_SEED
	for (let index = 0; index < value.length; index += 1) {
		// Classic djb2 (hash * 33 + char), wrapped to unsigned 32 bits.
		hash = (hash * DJB2_MULTIPLIER + value.charCodeAt(index)) >>> 0
	}
	return hash
}

/** A repo's stable accent hue — hashed from its path, never random. */
export const projectHue = (repoPath: string | null): Hue =>
	repoPath === null
		? HUES[0]
		: (HUES[djb2(repoPath) % HUES.length] ?? HUES[0])
