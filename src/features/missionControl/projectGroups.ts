/**
 * Pure helpers behind the project-grouped mission control wall: grouping
 * sessions by repo, naming/compacting repo paths and hashing them to a
 * stable accent hue.
 */
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import type { SessionState } from '@/features/sessions/sessions'

const STATUS_ORDER: Readonly<Record<SessionDisplayStatus, number>> = {
	running: 0,
	review: 1,
	failed: 2,
}

// Active work first, then most recently started — the cmux "what's hot" wall.
const compareCards = (a: SessionState, b: SessionState): number => {
	const byStatus =
		STATUS_ORDER[sessionDisplayStatus(a)] -
		STATUS_ORDER[sessionDisplayStatus(b)]
	return byStatus !== 0 ? byStatus : b.startedAt - a.startedAt
}

// TODO(backend): project registry — Mission Control only groups live
// sessions by repoPath; projects with no sessions cannot be listed
export type SessionGroup = {
	repoPath: string | null
	sessions: ReadonlyArray<SessionState>
}

export const groupSessionsByRepo = (
	sessions: ReadonlyArray<SessionState>,
): ReadonlyArray<SessionGroup> => {
	const byRepo = new Map<string | null, SessionState[]>()
	for (const session of sessions) {
		const group = byRepo.get(session.repoPath) ?? []
		group.push(session)
		byRepo.set(session.repoPath, group)
	}
	const groups = Array.from(byRepo, ([repoPath, grouped]) => ({
		repoPath,
		sessions: grouped.toSorted(compareCards),
	}))
	// Repo-less sessions always trail: they are the "no project" bucket.
	return groups.toSorted(
		(a, b) => Number(a.repoPath === null) - Number(b.repoPath === null),
	)
}

export { compactPath, projectName } from '@/features/projects/repoPaths'

/**
 * MP4's hybrid partition: a registered repo with no live session is dormant —
 * it folds into the compact section instead of holding a full wall group.
 */
export const dormantRepos = (
	groups: ReadonlyArray<SessionGroup>,
	registry: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	registry.filter(path => !groups.some(group => group.repoPath === path))

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

const latestStart = (group: SessionGroup): number =>
	group.sessions.reduce(
		(latest, session) => Math.max(latest, session.startedAt),
		0,
	)

/**
 * The wall's group order: the active project first, then the projects with
 * the freshest session activity; the repo-less bucket keeps trailing.
 */
export const orderProjectGroups = (
	groups: ReadonlyArray<SessionGroup>,
	activeProjectPath: string | null,
): ReadonlyArray<SessionGroup> =>
	groups.toSorted((a, b) => {
		const trailing =
			Number(a.repoPath === null) - Number(b.repoPath === null)
		if (trailing !== 0) return trailing
		const active =
			Number(b.repoPath === activeProjectPath) -
			Number(a.repoPath === activeProjectPath)
		return active !== 0 ? active : latestStart(b) - latestStart(a)
	})
