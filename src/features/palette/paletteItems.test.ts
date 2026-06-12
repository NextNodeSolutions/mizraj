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

const session = (id: string, overrides: Partial<SessionState> = {}): SessionState => ({
	id,
	binary: 'claude',
	repoPath: '/repo',
	title: null,
	output: [],
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

describe('buildPaletteItems', () => {
	it('always offers the screens', () => {
		const items = buildPaletteItems({
			sessions: [],
			plans: [],
			activeProjectPath: null,
		})

		const screens = items.filter(item => item.group === 'Go to')
		expect(screens.map(item => item.label)).toEqual([
			'Mission Control',
			'Pipeline',
			'Plans',
			'Tasks',
			'Diff review',
		])
	})

	it('lists each session with its status as a jump target', () => {
		const items = buildPaletteItems({
			sessions: [
				session('run-1'),
				session('done-1', { status: 'ended', exitCode: 0 }),
			],
			plans: [],
			activeProjectPath: null,
		})

		const agents = items.filter(item => item.group === 'Agents')
		expect(agents).toHaveLength(2)
		expect(agents[0]?.hint).toBe('running')
		expect(agents[1]?.hint).toBe('needs review')
	})

	it('lists plans and interviews', () => {
		const items = buildPaletteItems({
			sessions: [],
			plans: [PLAN],
			activeProjectPath: null,
		})

		expect(
			items.find(item => item.group === 'Plans')?.label,
		).toBe('Auth hardening')
	})

	it('offers launch actions only with an active project', () => {
		const without = buildPaletteItems({
			sessions: [],
			plans: [],
			activeProjectPath: null,
		})
		expect(without.some(item => item.group === 'Actions')).toBe(false)

		const withProject = buildPaletteItems({
			sessions: [],
			plans: [],
			activeProjectPath: '/repo',
		})
		expect(
			withProject
				.filter(item => item.group === 'Actions')
				.map(item => item.label),
		).toEqual(['New agent', 'New terminal'])
	})
})

describe('filterPaletteItems', () => {
	const items = buildPaletteItems({
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
			'New agent',
			'New terminal',
		])
	})
})
