import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type { PlanRoute } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

type ResolvedPlan = { url: string }

export type PlanResolution =
	| { status: 'loading' }
	| { status: 'ready'; url: string }
	| { status: 'error'; message: string }

/**
 * Resolve a routed plan/interview to its plan:// url via the backend, behind a
 * resource seam (mirrors usePlans/useTasks) so the view never touches invoke.
 * Re-resolves when the route's kind/slug change; a stale resolution from a
 * superseded route is dropped.
 */
export const useResolvedPlan = (route: PlanRoute | null): PlanResolution => {
	const [resolution, setResolution] = useState<PlanResolution>({
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
				logger.error(
					`useResolvedPlan: resolve_plan failed: ${message}`,
					{
						scope: 'plan-view',
						details: { stack, kind: routeKind, slug: routeSlug },
					},
				)
				if (!cancelled) {
					setResolution({ status: 'error', message })
				}
			})
		return () => {
			cancelled = true
		}
	}, [routeKind, routeSlug])

	return resolution
}
