import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNow } from './useNow'

const Clock = ({ intervalMs }: { intervalMs: number }): React.JSX.Element => {
	const now = useNow(intervalMs)
	return <time>{now}</time>
}

describe('useNow', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000)
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
		vi.useRealTimers()
	})

	it('returns the current time on first render', () => {
		act(() => {
			root.render(<Clock intervalMs={30_000} />)
		})

		expect(container.querySelector('time')?.textContent).toBe('1000')
	})

	it('re-renders with fresh time every interval', () => {
		act(() => {
			root.render(<Clock intervalMs={30_000} />)
		})

		act(() => {
			vi.advanceTimersByTime(30_000)
		})

		expect(container.querySelector('time')?.textContent).toBe('31000')
	})
})
