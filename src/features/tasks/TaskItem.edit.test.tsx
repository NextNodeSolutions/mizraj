import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

import TaskItem from './TaskItem'
import type { Task } from './tasks'

const USER_TASK: Task = {
	id: 'task-1',
	identifier: null,
	origin: 'user',
	milestoneId: null,
	trackId: null,
	step: null,
	title: 'Original title',
	description: 'Original description',
	doneWhen: null,
	size: null,
	sliceOf: [],
	sinkId: null,
	position: 0,
	status: 'backlog',
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-01-01T00:00:00Z',
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

describe('TaskItem inline editing', () => {
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

	it('saves the merged title, description and current status for a user task', async () => {
		const updatedRow: Task = {
			...USER_TASK,
			title: 'Edited title',
			description: 'Edited description',
		}
		invokeMock.mockResolvedValue(updatedRow)
		const onChanged = vi.fn()

		await act(async () => {
			root.render(<TaskItem task={USER_TASK} onChanged={onChanged} />)
		})

		const editButton = container.querySelector<HTMLButtonElement>(
			'.tasks-view__edit-toggle',
		)
		expect(editButton).not.toBeNull()
		await act(async () => {
			editButton?.click()
		})

		const titleInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Title for Original title"]',
		)
		const descriptionInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Description for Original title"]',
		)
		expect(titleInput).not.toBeNull()
		expect(descriptionInput).not.toBeNull()

		await act(async () => {
			if (titleInput !== null) setInputValue(titleInput, 'Edited title')
			if (descriptionInput !== null) {
				setInputValue(descriptionInput, 'Edited description')
			}
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
			id: 'task-1',
			title: 'Edited title',
			description: 'Edited description',
			status: 'backlog',
		})
		expect(onChanged).toHaveBeenCalledTimes(1)
	})

	it('exposes both edit and status affordances for a user task', async () => {
		const onChanged = vi.fn()

		await act(async () => {
			root.render(<TaskItem task={USER_TASK} onChanged={onChanged} />)
		})

		expect(
			container.querySelector('.tasks-view__edit-toggle'),
		).not.toBeNull()
		expect(
			container.querySelector('.tasks-view__status-select'),
		).not.toBeNull()
		expect(invokeMock).not.toHaveBeenCalled()
	})
})
