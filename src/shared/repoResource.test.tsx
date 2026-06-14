import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A capturing appFocus stub so a test can fire a window-focus reload on demand.
const { focusSubscribers, fireAppFocus } = vi.hoisted(() => {
	const subscribers = new Set<() => void>()
	return {
		focusSubscribers: subscribers,
		fireAppFocus: (): void => {
			for (const notify of subscribers) notify()
		},
	}
})

vi.mock('./appFocus', () => ({
	onAppFocus: (onFocus: () => void): (() => void) => {
		focusSubscribers.add(onFocus)
		return () => {
			focusSubscribers.delete(onFocus)
		}
	},
}))

vi.mock('@/features/projects/repoEvents', () => ({
	onRepoChanged: (): (() => void) => () => {},
}))

vi.mock('./logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { useRepoResource } from './repoResource'

type Payload = { patch: string }

const sameDiff = (previous: Payload, next: Payload): boolean =>
	previous.patch === next.patch

// A fresh object every call, but always the same patch — the on-disk state did
// not change between focus reloads.
const constPatchFetcher = (): Promise<Payload> => Promise.resolve({ patch: 'X' })

describe('useRepoResource', () => {
	let container: HTMLDivElement
	let root: Root
	let lastReady: Payload | null
	let readyCount: number

	const Probe = ({
		repoPath,
		fetcher,
		isEqual,
	}: {
		repoPath: string | null
		fetcher: (repoPath: string) => Promise<Payload>
		isEqual?: (previous: Payload, next: Payload) => boolean
	}): React.JSX.Element => {
		const { state } = useRepoResource(
			repoPath,
			fetcher,
			'test',
			'test',
			isEqual,
		)
		if (state.status === 'ready') {
			readyCount += 1
			lastReady = state.data
		}
		return <div data-status={state.status} />
	}

	beforeEach(() => {
		focusSubscribers.clear()
		lastReady = null
		readyCount = 0
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

	it('keeps the ready object stable when a focus reload returns equal data', async () => {
		await act(async () => {
			root.render(
				<Probe
					repoPath="/repo"
					fetcher={constPatchFetcher}
					isEqual={sameDiff}
				/>,
			)
		})
		const first = lastReady

		await act(async () => {
			fireAppFocus()
		})

		// Same reference: the equal reload was deduped, so no downstream memo
		// (re-parse, re-diff) is invalidated by a no-op refresh.
		expect(lastReady).toBe(first)
	})

	it('applies a focus reload that returns changed data', async () => {
		let patch = 'X'
		const fetcher = (): Promise<Payload> => Promise.resolve({ patch })

		await act(async () => {
			root.render(
				<Probe repoPath="/repo" fetcher={fetcher} isEqual={sameDiff} />,
			)
		})
		const first = lastReady

		patch = 'Y'
		await act(async () => {
			fireAppFocus()
		})

		expect(lastReady).not.toBe(first)
		expect(lastReady?.patch).toBe('Y')
	})

	it('without an equality test every reload applies a fresh object', async () => {
		await act(async () => {
			root.render(<Probe repoPath="/repo" fetcher={constPatchFetcher} />)
		})
		const first = lastReady

		await act(async () => {
			fireAppFocus()
		})

		// No isEqual: the equal reload still replaces the object (backward
		// compatible with callers that did not opt into dedup).
		expect(lastReady).not.toBe(first)
	})
})
