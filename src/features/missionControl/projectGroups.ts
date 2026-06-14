/**
 * Pure helpers behind the project-grouped mission control wall: grouping
 * sessions by repo, ordering the wall, and deriving the filtered view. Repo
 * path display/hue helpers live in repoPaths.ts (re-exported below).
 */
import type { MissionFilter } from '@/app/router'
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

export {
	compactPath,
	HUES,
	projectHue,
	projectName,
} from '@/features/projects/repoPaths'

/**
 * MP4's hybrid partition: a registered repo with no live session is dormant —
 * it folds into the compact section instead of holding a full wall group. The
 * followed repo is never dormant: it always keeps a top group on the wall
 * (see `withActiveGroup`), so it is excluded here even with zero sessions.
 */
export const dormantRepos = (
	groups: ReadonlyArray<SessionGroup>,
	registry: ReadonlyArray<string>,
	activeProjectPath: string | null,
): ReadonlyArray<string> => {
	const deduped = Array.from(new Set(registry))
	return deduped.filter(
		path =>
			path !== activeProjectPath &&
			!groups.some(group => group.repoPath === path),
	)
}

/**
 * Guarantees the followed repo a wall group: if `activeProjectPath` has no
 * live session it gets an empty group so it is never hidden in the dormant
 * tail. Ordering still pins it to the top (see `orderProjectGroups`).
 */
export const withActiveGroup = (
	groups: ReadonlyArray<SessionGroup>,
	activeProjectPath: string | null,
): ReadonlyArray<SessionGroup> => {
	if (activeProjectPath === null) return groups
	if (groups.some(group => group.repoPath === activeProjectPath))
		return groups
	return [{ repoPath: activeProjectPath, sessions: [] }, ...groups]
}

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

const matchesFilter = (session: SessionState, filter: MissionFilter): boolean =>
	filter === 'all' || sessionDisplayStatus(session) === filter

export type VisibleProjectGroup = {
	group: SessionGroup
	isActive: boolean
	visibleSessions: ReadonlyArray<SessionState>
}

export type VisibleProjectGroups = {
	/** All ordered groups (active-first), pre-filter — drives the project count. */
	groups: ReadonlyArray<SessionGroup>
	/** Groups surviving the filter; the active group stays pinned even if empty. */
	visibleGroups: ReadonlyArray<VisibleProjectGroup>
	/** Total cards across visibleGroups. */
	visibleCardCount: number
}

/**
 * The wall's render model: order the groups (active repo pinned, see
 * orderProjectGroups), then drop groups whose every card is filtered out —
 * except the followed repo, which keeps its (possibly empty) group on top.
 */
export const visibleProjectGroups = (
	sessionGroups: ReadonlyArray<SessionGroup>,
	activeProjectPath: string | null,
	filter: MissionFilter,
): VisibleProjectGroups => {
	const groups = orderProjectGroups(
		withActiveGroup(sessionGroups, activeProjectPath),
		activeProjectPath,
	)
	const visibleGroups = groups
		.map(group => ({
			group,
			isActive: group.repoPath === activeProjectPath,
			visibleSessions: group.sessions.filter(session =>
				matchesFilter(session, filter),
			),
		}))
		.filter(
			({ isActive, visibleSessions }) =>
				isActive || visibleSessions.length > 0,
		)
	const visibleCardCount = visibleGroups.reduce(
		(total, { visibleSessions }) => total + visibleSessions.length,
		0,
	)
	return { groups, visibleGroups, visibleCardCount }
}
