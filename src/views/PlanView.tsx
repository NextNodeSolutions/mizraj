import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import PlanPanel from '../components/PlanPanel'
import { describeError } from '../errors'
import { logger } from '../logger'
import type { PlanRoute } from '../router'
import { matchPlanRoute, usePathname } from '../router'

type ResolvedPlan = { url: string }

type Resolution =
	| { status: 'loading' }
	| { status: 'ready'; url: string }
	| { status: 'error'; message: string }

const planKey = ({ kind, slug }: PlanRoute): string => `${kind}/${slug}`

const PlanView = (): React.JSX.Element => {
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
		return (
			<p className="plan-view__empty">Select a plan from the sidebar.</p>
		)
	}
	if (resolution.status === 'loading') {
		return (
			<p className="plan-view__empty" role="status" aria-live="polite">
				Loading plan…
			</p>
		)
	}
	if (resolution.status === 'error') {
		return (
			<p
				className="plan-view__empty plan-view__empty--error"
				role="alert"
			>
				Plan unavailable: {resolution.message}
			</p>
		)
	}
	const key = planKey(route)
	return <PlanPanel key={key} src={resolution.url} title={key} />
}

export default PlanView
