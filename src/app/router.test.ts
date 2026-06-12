import { describe, expect, it } from 'vitest'

import {
	matchMissionControlRoute,
	matchPipelineRoute,
	matchPlanRoute,
	matchPlansIndexRoute,
	matchReviewRoute,
	matchTasksRoute,
	missionControlHref,
	pipelineHref,
	plansIndexHref,
	reviewHref,
} from './router'

describe('mission control route', () => {
	it('is the app home', () => {
		expect(missionControlHref()).toBe('/')
		expect(matchMissionControlRoute('/')).toBe(true)
	})

	it('does not match other screens', () => {
		expect(matchMissionControlRoute('/pipeline')).toBe(false)
		expect(matchMissionControlRoute('/tasks')).toBe(false)
	})
})

describe('pipeline route', () => {
	it('round-trips through its href', () => {
		expect(matchPipelineRoute(pipelineHref())).toBe(true)
	})

	it('rejects unrelated paths', () => {
		expect(matchPipelineRoute('/')).toBe(false)
		expect(matchPipelineRoute('/pipeline/extra')).toBe(false)
	})
})

describe('review route', () => {
	it('round-trips through its href', () => {
		expect(matchReviewRoute(reviewHref())).toBe(true)
	})

	it('rejects unrelated paths', () => {
		expect(matchReviewRoute('/reviews')).toBe(false)
	})
})

describe('plans index route', () => {
	it('matches the bare plans path', () => {
		expect(matchPlansIndexRoute(plansIndexHref())).toBe(true)
	})

	it('leaves deep plan links to the plan matcher', () => {
		expect(matchPlansIndexRoute('/plans/plan/my-slug')).toBe(false)
		expect(matchPlanRoute('/plans/plan/my-slug')).toEqual({
			kind: 'plan',
			slug: 'my-slug',
		})
	})
})

describe('existing routes still resolve', () => {
	it('matches tasks', () => {
		expect(matchTasksRoute('/tasks')).toBe(true)
	})
})
