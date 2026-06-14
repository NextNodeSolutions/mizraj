import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import type { PlanEntry } from '@/features/plans/plans'
import type { SessionState } from '@/features/sessions/sessions'

import { buildPaletteItems, filterPaletteItems } from './paletteItems'

const session = (
	id: string,
	overrides: Partial<SessionState> = {},
): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	status: 'running',
	exitCode: null,
	startedAt: 0,
	...overrides,
})

const PLAN: PlanEntry = {
	kind: 'plan',
	slug: 'auth',
	title: 'Auth hardening',
	url: 'plan://plan/auth',
	mtime: 0,
}

const build = (
	overrides: Partial<Parameters<typeof buildPaletteItems>[0]> = {},
): ReturnType<typeof buildPaletteItems> =>
	buildPaletteItems({
		sessions: [],
		plans: [],
		activeProjectPath: null,
		activeSessionId: null,
		...overrides,
	})

describe('buildPaletteItems', () => {
	it('orders the groups agents, review, plans, go to, actions', () => {
		const items = build({
			sessions: [
				session('run-1'),
				session('done-1', { status: 'ended', exitCode: 0 }),
			],
			plans: [PLAN],
			activeProjectPath: '/repo',
		})

		const groupSequence = items
			.map(item => item.group)
			.filter((group, index, groups) => groups[index - 1] !== group)
		expect(groupSequence).toEqual([
			'Agents',
			'Review',
			'Plans',
			'Go to',
			'Actions',
		])
	})

	it('always offers the screens with their chord hints', () => {
		const screens = build().filter(item => item.group === 'Go to')

		expect(screens.map(item => [item.label, item.hint])).toEqual([
			['Mission Control', '⌘1'],
			['Cockpit', '⌘2'],
			['Pipeline board', '⌘3'],
			['Plans', '⌘4'],
			['Diff review', '⌘5'],
			['Tasks', undefined],
		])
	})

	it('sends the cockpit screen to the target session', () => {
		window.history.pushState({}, '', '/')
		const items = build({
			sessions: [session('sess-7')],
			activeSessionId: 'sess-7',
		})

		items
			.filter(item => item.group === 'Go to')
			.find(item => item.label === 'Cockpit')
			?.run()

		expect(window.location.pathname).toBe('/agent-run/sess-7')
	})

	it('lists each session with its status as a jump target', () => {
		const items = build({
			sessions: [
				session('run-1'),
				session('done-1', { status: 'ended', exitCode: 0 }),
			],
		})

		const agents = items.filter(item => item.group === 'Agents')
		expect(agents).toHaveLength(2)
		expect(agents[0]?.hint).toBe('running')
		expect(agents[1]?.hint).toBe('needs review')
	})

	it('gives every item a unique id even when two sessions share a label', () => {
		const items = build({
			sessions: [
				session('run-1', { repoPath: '/Users/me/dev/mizraj' }),
				session('run-2', { repoPath: '/Users/me/dev/mizraj' }),
			],
			plans: [PLAN],
			activeProjectPath: '/repo',
		})

		// Two claude sessions in the same repo collide on the label — the React
		// key must come from the id, which stays unique.
		const agents = items.filter(item => item.group === 'Agents')
		expect(agents.map(item => item.label)).toEqual([
			'claude — mizraj',
			'claude — mizraj',
		])
		const ids = items.map(item => item.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('labels agents with their repo when known', () => {
		const items = build({
			sessions: [session('run-1', { repoPath: '/Users/me/dev/mizraj' })],
		})

		expect(items.find(item => item.group === 'Agents')?.label).toBe(
			'claude — mizraj',
		)
	})

	it('surfaces ended-clean sessions as review entries', () => {
		window.history.pushState({}, '', '/')
		const items = build({
			sessions: [
				session('run-1'),
				session('done-1', { status: 'ended', exitCode: 0 }),
			],
		})

		const review = items.filter(item => item.group === 'Review')
		expect(review).toHaveLength(1)
		expect(review[0]?.label).toBe('claude — needs review')

		review[0]?.run()
		expect(window.location.pathname).toBe('/review')
	})

	it('lists plans and interviews', () => {
		const items = build({ plans: [PLAN] })

		expect(items.find(item => item.group === 'Plans')?.label).toBe(
			'Auth hardening',
		)
	})

	it('offers launch actions only with an active project', () => {
		expect(build().some(item => item.group === 'Actions')).toBe(false)

		const withProject = build({ activeProjectPath: '/repo' })
		expect(
			withProject
				.filter(item => item.group === 'Actions')
				.map(item => [item.label, item.hint]),
		).toEqual([
			['New agent…', '↵'],
			['New terminal', undefined],
		])
	})
})

describe('filterPaletteItems', () => {
	const items = build({
		sessions: [session('run-1')],
		plans: [PLAN],
		activeProjectPath: '/repo',
	})

	it('keeps everything on an empty query', () => {
		expect(filterPaletteItems(items, '')).toEqual(items)
	})

	it('matches labels case-insensitively', () => {
		const found = filterPaletteItems(items, 'AUTH')
		expect(found.map(item => item.label)).toEqual(['Auth hardening'])
	})

	it('matches on the group name too', () => {
		const found = filterPaletteItems(items, 'actions')
		expect(found.map(item => item.label)).toEqual([
			'New agent…',
			'New terminal',
		])
	})
})
