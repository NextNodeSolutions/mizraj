import { useEffect, useState } from 'react'

import { PLAN_KINDS, type PlanKind } from './lib/plans'

const PLANS_PATH_ROOT = 'plans'
const PLAN_KIND_SET: ReadonlySet<string> = new Set(PLAN_KINDS)

export type PlanRoute = { kind: PlanKind; slug: string }

export const planRouteHref = ({ kind, slug }: PlanRoute): string =>
	`/${PLANS_PATH_ROOT}/${kind}/${slug}`

const isPlanRoute = (
	segments: ReadonlyArray<string>,
): segments is readonly [typeof PLANS_PATH_ROOT, PlanKind, string] =>
	segments.length === 3 &&
	segments[0] === PLANS_PATH_ROOT &&
	segments[1] !== undefined &&
	PLAN_KIND_SET.has(segments[1])

export const matchPlanRoute = (pathname: string): PlanRoute | null => {
	const segments = pathname.split('/').filter(Boolean)
	return isPlanRoute(segments)
		? { kind: segments[1], slug: segments[2] }
		: null
}

export const navigate = (href: string): void => {
	if (window.location.pathname === href) return
	window.history.pushState({}, '', href)
	window.dispatchEvent(new PopStateEvent('popstate'))
}

const readPathname = (): string => window.location.pathname

export const usePathname = (): string => {
	const [pathname, setPathname] = useState<string>(readPathname)
	useEffect(() => {
		const handler = (): void => setPathname(readPathname())
		window.addEventListener('popstate', handler)
		return () => window.removeEventListener('popstate', handler)
	}, [])
	return pathname
}
