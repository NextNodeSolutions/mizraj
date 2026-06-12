import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { BranchChip } from './BranchChip'

describe('BranchChip', () => {
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

	it('shows the checked-out branch', async () => {
		invokeMock.mockResolvedValue({ branch: 'feat/ui', detached: false })

		await act(async () => {
			root.render(<BranchChip repoPath="/repo" />)
		})

		expect(container.textContent).toContain('feat/ui')
	})

	it('labels a detached head', async () => {
		invokeMock.mockResolvedValue({ branch: null, detached: true })

		await act(async () => {
			root.render(<BranchChip repoPath="/repo" />)
		})

		expect(container.textContent).toContain('detached HEAD')
	})

	it('renders nothing while the head is unknown', async () => {
		invokeMock.mockRejectedValue(new Error('not a repo'))

		await act(async () => {
			root.render(<BranchChip repoPath="/repo" />)
		})

		expect(container.textContent).toBe('')
	})
})
