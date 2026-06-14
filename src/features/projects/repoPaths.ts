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
