import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type { PlanRoute } from '@/app/router'
import { matchPlanRoute, usePathname } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { buildPlanDoc } from './planDoc'
import { PlanPaper } from './PlanPaper'
import type { PlanEntry } from './plans'

type ResolvedPlan = { url: string }

type Resolution =
	| { status: 'loading' }
	| { status: 'ready'; url: string }
	| { status: 'error'; message: string }

const planKey = ({ kind, slug }: PlanRoute): string => `${kind}/${slug}`

const matchingEntry = (
	plans: ReadonlyArray<PlanEntry>,
	route: PlanRoute,
): PlanEntry | null =>
	plans.find(
		entry => entry.kind === route.kind && entry.slug === route.slug,
	) ?? null

type Props = {
	plans: ReadonlyArray<PlanEntry>
	nowMs: number
}

export const PlanView = ({ plans, nowMs }: Props): React.JSX.Element => {
	const pathname = usePathname()
	const route = matchPlanRoute(pathname)
	const [resolution, setResolution] = useState<Resolution>({
		status: 'loading',
	})

	const routeKind = route?.kind
	const routeSlug = route?.slug

	useEffect(() => {
		if (routeKind === undefined || routeSlug === undefined) return
		let cancelled = false
		setResolution({ status: 'loading' })
		invoke<ResolvedPlan>('resolve_plan', {
			kind: routeKind,
			slug: routeSlug,
		})
			.then(resolved => {
				if (!cancelled) {
					setResolution({ status: 'ready', url: resolved.url })
				}
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`PlanView: resolve_plan failed: ${message}`, {
					scope: 'plan-view',
					details: { stack, kind: routeKind, slug: routeSlug },
				})
				if (!cancelled) {
					setResolution({ status: 'error', message })
				}
			})
		return () => {
			cancelled = true
		}
	}, [routeKind, routeSlug])

	if (!route) {
		return <p className="pl-doc-empty">Select a plan from the list.</p>
	}
	if (resolution.status === 'loading') {
		return (
			<p className="pl-doc-empty" role="status" aria-live="polite">
				Loading plan…
			</p>
		)
	}
	if (resolution.status === 'error') {
		return (
			<p className="pl-doc-empty" role="alert">
				Plan unavailable: {resolution.message}
			</p>
		)
	}
	return (
		<PlanPaper
			key={planKey(route)}
			doc={buildPlanDoc(
				route,
				resolution.url,
				matchingEntry(plans, route),
				nowMs,
			)}
		/>
	)
}
