import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

import PlanTree from './PlanTree'
import type { MilestoneGroup, Task } from './tasks'

const trackTask: Task = {
	id: 'track-1',
	identifier: '[M1.A-01]',
	origin: 'track',
	milestoneId: 'M1',
	trackId: 'M1.A',
	step: '01',
	title: 'Scaffold module',
	description: null,
	doneWhen: null,
	size: 'I4',
	sliceOf: [],
	sinkId: null,
	position: 0,
	status: 'backlog',
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
}

const MILESTONES: ReadonlyArray<MilestoneGroup> = [
	{
		id: 'M1',
		number: 1,
		demo: 'Boot the cockpit',
		skeleton: true,
		needs: [],
		tracks: [{ id: 'M1.A', branch: 'feat/m1-a', tasks: [trackTask] }],
	},
	{
		id: 'M2',
		number: 2,
		demo: 'Wire the tree',
		skeleton: false,
		needs: ['M1'],
		tracks: [{ id: 'M2.A', branch: 'feat/m2-a', tasks: [] }],
	},
]

describe('PlanTree grouped rendering', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockReset()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	it('renders each milestone with its demo, skeleton badge and needs', async () => {
		await act(async () => {
			root.render(
				<PlanTree milestones={MILESTONES} onChanged={vi.fn()} />,
			)
		})

		const milestoneIds = Array.from(
			container.querySelectorAll('.tasks-tree__milestone-id'),
		).map(node => node.textContent)
		expect(milestoneIds).toEqual(['M1', 'M2'])

		const demos = Array.from(
			container.querySelectorAll('.tasks-tree__milestone-demo'),
		).map(node => node.textContent)
		expect(demos).toEqual(['Boot the cockpit', 'Wire the tree'])

		const badges = container.querySelectorAll('.tasks-tree__badge')
		expect(badges).toHaveLength(1)
		expect(badges[0]?.textContent).toBe('skeleton')

		const needs = container.querySelector('.tasks-tree__needs')
		expect(needs?.textContent).toBe('needs: M1')
	})

	it('renders each track with its id, branch and task rows', async () => {
		await act(async () => {
			root.render(
				<PlanTree milestones={MILESTONES} onChanged={vi.fn()} />,
			)
		})

		const trackIds = Array.from(
			container.querySelectorAll('.tasks-tree__track-id'),
		).map(node => node.textContent)
		expect(trackIds).toEqual(['M1.A', 'M2.A'])

		const branches = Array.from(
			container.querySelectorAll('.tasks-tree__track-branch'),
		).map(node => node.textContent)
		expect(branches).toEqual(['feat/m1-a', 'feat/m2-a'])

		expect(
			container.querySelector('.tasks-view__identifier')?.textContent,
		).toBe('[M1.A-01]')
	})

	it('reads cleanly when no plan has been ingested', async () => {
		await act(async () => {
			root.render(<PlanTree milestones={[]} onChanged={vi.fn()} />)
		})

		expect(container.querySelector('.tasks-view__empty')?.textContent).toBe(
			'No plan ingested for this project yet.',
		)
	})
})
