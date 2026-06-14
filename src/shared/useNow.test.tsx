import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNow } from './useNow'

const INTERVAL_MS = 1000

let latest = 0

const Probe = (): React.JSX.Element => {
	latest = useNow(INTERVAL_MS)
	return <output>{latest}</output>
}

const setVisibility = (state: DocumentVisibilityState): void => {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	})
	document.dispatchEvent(new Event('visibilitychange'))
}

describe('useNow', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		vi.useFakeTimers()
		setVisibility('visible')
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		act(() => {
			root.render(<Probe />)
		})
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
		vi.useRealTimers()
		setVisibility('visible')
	})

	it('ticks on the interval while the window is visible', () => {
		const first = latest

		act(() => {
			vi.setSystemTime(Date.now() + INTERVAL_MS)
			vi.advanceTimersByTime(INTERVAL_MS)
		})

		expect(latest).not.toBe(first)
		expect(latest).toBeGreaterThan(first)
	})

	it('stops ticking while the window is hidden', () => {
		act(() => {
			setVisibility('hidden')
		})
		const parked = latest

		act(() => {
			vi.setSystemTime(Date.now() + INTERVAL_MS * 5)
			vi.advanceTimersByTime(INTERVAL_MS * 5)
		})

		// No interval fires while hidden, so the value never moves.
		expect(latest).toBe(parked)
	})

	it('resyncs once when the window becomes visible again', () => {
		act(() => {
			setVisibility('hidden')
			vi.setSystemTime(Date.now() + INTERVAL_MS * 3)
			vi.advanceTimersByTime(INTERVAL_MS * 3)
		})
		const parked = latest

		act(() => {
			setVisibility('visible')
		})

		// Re-show ticks once immediately to catch up the drifted clock.
		expect(latest).not.toBe(parked)
		expect(latest).toBeGreaterThan(parked)
	})
})
