import { useEffect, useState } from 'react'

import type { PlanKind } from '@/features/plans/plans'
import { PLAN_KINDS } from '@/features/plans/plans'

const PLANS_PATH_ROOT = 'plans'
const AGENT_RUN_PATH_ROOT = 'agent-run'
const TASKS_PATH_ROOT = 'tasks'
const PIPELINE_PATH_ROOT = 'pipeline'
const REVIEW_PATH_ROOT = 'review'
const PLAN_KIND_SET: ReadonlySet<string> = new Set(PLAN_KINDS)
const PLAN_ROUTE_SEGMENTS = 3
const AGENT_RUN_ROUTE_SEGMENTS = 2
const KIND_INDEX = 1
const SLUG_INDEX = 2
const AGENT_SESSION_ID_INDEX = 1

export type PlanRoute = { kind: PlanKind; slug: string }
export type AgentRunRoute = { sessionId: string }

export const planRouteHref = ({ kind, slug }: PlanRoute): string =>
	`/${PLANS_PATH_ROOT}/${kind}/${slug}`

export const agentRunHref = (sessionId: string): string =>
	`/${AGENT_RUN_PATH_ROOT}/${sessionId}`

/** The cockpit with no session yet — its empty state. */
export const agentRunIndexHref = (): string => `/${AGENT_RUN_PATH_ROOT}`

export const tasksHref = (): string => `/${TASKS_PATH_ROOT}`

export const MISSION_FILTERS = ['running', 'review', 'failed'] as const

/** The status filters mission control can be deep-linked to. */
export type MissionControlFilter = (typeof MISSION_FILTERS)[number]

/** What mission control reads back from the URL: a filter, or everything. */
export type MissionFilter = MissionControlFilter | 'all'

export const missionControlHref = (filter?: MissionControlFilter): string =>
	filter === undefined ? '/' : `/?filter=${filter}`

const isMissionControlFilter = (value: string): value is MissionControlFilter =>
	MISSION_FILTERS.some(filter => filter === value)

export const parseMissionFilter = (search: string): MissionFilter => {
	const value = new URLSearchParams(search).get('filter')
	return value !== null && isMissionControlFilter(value) ? value : 'all'
}

export const pipelineHref = (): string => `/${PIPELINE_PATH_ROOT}`

export const reviewHref = (file?: string): string =>
	file === undefined
		? `/${REVIEW_PATH_ROOT}`
		: `/${REVIEW_PATH_ROOT}?file=${encodeURIComponent(file)}`

/** The file the review screen should preselect, when deep-linked. */
export const parseReviewFile = (search: string): string | null => {
	const value = new URLSearchParams(search).get('file')
	return value !== null && value !== '' ? value : null
}

export const plansIndexHref = (): string => `/${PLANS_PATH_ROOT}`

const isPlanRoute = (
	segments: ReadonlyArray<string>,
): segments is readonly [typeof PLANS_PATH_ROOT, PlanKind, string] =>
	segments.length === PLAN_ROUTE_SEGMENTS &&
	segments[0] === PLANS_PATH_ROOT &&
	segments[KIND_INDEX] !== undefined &&
	PLAN_KIND_SET.has(segments[KIND_INDEX])

const isAgentRunRoute = (
	segments: ReadonlyArray<string>,
): segments is readonly [typeof AGENT_RUN_PATH_ROOT, string] =>
	segments.length === AGENT_RUN_ROUTE_SEGMENTS &&
	segments[0] === AGENT_RUN_PATH_ROOT &&
	segments[AGENT_SESSION_ID_INDEX] !== undefined &&
	segments[AGENT_SESSION_ID_INDEX].length > 0

export const matchPlanRoute = (pathname: string): PlanRoute | null => {
	const segments = pathname.split('/').filter(Boolean)
	return isPlanRoute(segments)
		? { kind: segments[KIND_INDEX], slug: segments[SLUG_INDEX] }
		: null
}

export const matchAgentRunRoute = (pathname: string): AgentRunRoute | null => {
	const segments = pathname.split('/').filter(Boolean)
	return isAgentRunRoute(segments)
		? { sessionId: segments[AGENT_SESSION_ID_INDEX] }
		: null
}

const isSingleSegment = (pathname: string, root: string): boolean => {
	const segments = pathname.split('/').filter(Boolean)
	return segments.length === 1 && segments[0] === root
}

export const matchTasksRoute = (pathname: string): boolean =>
	isSingleSegment(pathname, TASKS_PATH_ROOT)

export const matchAgentRunIndexRoute = (pathname: string): boolean =>
	isSingleSegment(pathname, AGENT_RUN_PATH_ROOT)

export const matchMissionControlRoute = (pathname: string): boolean =>
	pathname.split('/').filter(Boolean).length === 0

export const matchPipelineRoute = (pathname: string): boolean =>
	isSingleSegment(pathname, PIPELINE_PATH_ROOT)

export const matchReviewRoute = (pathname: string): boolean =>
	isSingleSegment(pathname, REVIEW_PATH_ROOT)

export const matchPlansIndexRoute = (pathname: string): boolean =>
	isSingleSegment(pathname, PLANS_PATH_ROOT)

// TODO(route-restore): the app always boots at '/'; persist the last
// pathname+search via the settings store and restore it after settings.ready.
export const navigate = (href: string): void => {
	// Compare the full location (path + query) so '/?filter=running' is a
	// real navigation from '/', and re-navigating it is still a no-op.
	if (window.location.pathname + window.location.search === href) return
	window.history.pushState({}, '', href)
	window.dispatchEvent(new PopStateEvent('popstate'))
}

const readPathname = (): string => window.location.pathname

const readSearch = (): string => window.location.search

// Both location hooks ride the same popstate subscription; navigate() above
// dispatches a synthetic popstate so pushes re-render subscribers too.
const useLocationValue = (read: () => string): string => {
	const [value, setValue] = useState<string>(read)
	useEffect(() => {
		const handler = (): void => setValue(read())
		window.addEventListener('popstate', handler)
		return () => window.removeEventListener('popstate', handler)
	}, [read])
	return value
}

export const usePathname = (): string => useLocationValue(readPathname)

export const useLocationSearch = (): string => useLocationValue(readSearch)
