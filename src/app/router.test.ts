import { describe, expect, it, vi } from 'vitest'

import {
	agentRunIndexHref,
	matchAgentRunIndexRoute,
	matchAgentRunRoute,
	matchMissionControlRoute,
	matchPipelineRoute,
	matchPlanRoute,
	matchPlansIndexRoute,
	matchReviewRoute,
	matchTasksRoute,
	missionControlHref,
	navigate,
	parseMissionFilter,
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

	it('deep-links a status filter through the query string', () => {
		expect(missionControlHref('running')).toBe('/?filter=running')
		expect(missionControlHref('review')).toBe('/?filter=review')
		expect(missionControlHref('failed')).toBe('/?filter=failed')
	})
})

describe('mission filter param', () => {
	it('parses a valid filter from a search string', () => {
		expect(parseMissionFilter('?filter=running')).toBe('running')
		expect(parseMissionFilter('?filter=review')).toBe('review')
		expect(parseMissionFilter('?filter=failed')).toBe('failed')
	})

	it('falls back to all on anything else', () => {
		expect(parseMissionFilter('')).toBe('all')
		expect(parseMissionFilter('?filter=bogus')).toBe('all')
		expect(parseMissionFilter('?other=1')).toBe('all')
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

describe('agent-run index route', () => {
	it('round-trips through its href — the cockpit without a session', () => {
		expect(matchAgentRunIndexRoute(agentRunIndexHref())).toBe(true)
	})

	it('leaves session deep links to the session matcher', () => {
		expect(matchAgentRunIndexRoute('/agent-run/sess-1')).toBe(false)
		expect(matchAgentRunRoute('/agent-run')).toBeNull()
	})
})

describe('navigate', () => {
	it('pushes a same-path navigation that only changes the query', () => {
		window.history.pushState({}, '', '/')

		navigate('/?filter=running')

		expect(window.location.pathname).toBe('/')
		expect(window.location.search).toBe('?filter=running')
	})

	it('does nothing when pathname and query already match', () => {
		window.history.pushState({}, '', '/?filter=running')
		const onPop = vi.fn()
		window.addEventListener('popstate', onPop)

		navigate('/?filter=running')

		window.removeEventListener('popstate', onPop)
		expect(onPop).not.toHaveBeenCalled()
	})
})

describe('existing routes still resolve', () => {
	it('matches tasks', () => {
		expect(matchTasksRoute('/tasks')).toBe(true)
	})
})
