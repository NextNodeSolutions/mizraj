import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

import type { Task } from '../../lib/tasks'
import TrackTaskRow from '../TrackTaskRow'

const TRACK_TASK: Task = {
	id: 'track-1',
	identifier: '[M1.A-01]',
	origin: 'track',
	milestoneId: 'M1',
	trackId: 'M1.A',
	step: '01',
	title: 'Tracked step',
	description: 'Step body kept verbatim',
	doneWhen: 'tests green',
	size: 'I4',
	sliceOf: ['D2', 'D3'],
	sinkId: null,
	position: 0,
	status: 'in_progress',
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
}

const BLOCKED_TRACK_TASK: Task = {
	...TRACK_TASK,
	id: 'track-2',
	status: 'blocked',
	blockedReason: 'waiting on M1.A-00',
}

const setInputValue = (input: HTMLInputElement, value: string): void => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		'value',
	)?.set
	expect(setter).toBeDefined()
	setter?.call(input, value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('TrackTaskRow read-only-except-name', () => {
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

	it('renders identifier, title and size with no status or description editor', async () => {
		const onChanged = vi.fn()

		await act(async () => {
			root.render(
				<TrackTaskRow task={TRACK_TASK} onChanged={onChanged} />,
			)
		})

		expect(
			container.querySelector('.tasks-view__identifier')?.textContent,
		).toBe('[M1.A-01]')
		expect(container.querySelector('.tasks-view__title')?.textContent).toBe(
			'Tracked step',
		)
		expect(container.querySelector('.tasks-view__size')?.textContent).toBe(
			'I4',
		)
		expect(container.querySelector('.tasks-view__status-select')).toBeNull()
		expect(invokeMock).not.toHaveBeenCalled()
	})

	it('shows the blocked reason only when the task is blocked', async () => {
		const onChanged = vi.fn()

		await act(async () => {
			root.render(
				<TrackTaskRow
					task={BLOCKED_TRACK_TASK}
					onChanged={onChanged}
				/>,
			)
		})

		expect(
			container.querySelector('.tasks-view__blocked-reason')?.textContent,
		).toBe('waiting on M1.A-00')
	})

	it('renames the task, preserving its description and status verbatim', async () => {
		invokeMock.mockResolvedValue({ ...TRACK_TASK, title: 'Renamed step' })
		const onChanged = vi.fn()

		await act(async () => {
			root.render(
				<TrackTaskRow task={TRACK_TASK} onChanged={onChanged} />,
			)
		})

		const renameButton = container.querySelector<HTMLButtonElement>(
			'.tasks-view__edit-toggle',
		)
		expect(renameButton).not.toBeNull()
		await act(async () => {
			renameButton?.click()
		})

		const nameInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Name for Tracked step"]',
		)
		expect(nameInput).not.toBeNull()
		expect(
			container.querySelector('input[aria-label*="Description"]'),
		).toBeNull()

		await act(async () => {
			if (nameInput !== null) setInputValue(nameInput, 'Renamed step')
		})

		const form =
			container.querySelector<HTMLFormElement>('.tasks-view__edit')
		expect(form).not.toBeNull()
		await act(async () => {
			form?.requestSubmit()
		})

		expect(invokeMock).toHaveBeenCalledTimes(1)
		const [command, payload] = invokeMock.mock.lastCall ?? []
		expect(command).toBe('tasks_update')
		expect(payload).toEqual({
			id: 'track-1',
			title: 'Renamed step',
			description: 'Step body kept verbatim',
			status: 'in_progress',
		})
		expect(onChanged).toHaveBeenCalledTimes(1)
	})
})
