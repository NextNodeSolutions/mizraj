import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { navigate, useLocationSearch } from './router'

const SearchProbe = (): React.JSX.Element => {
	const search = useLocationSearch()
	return <output>{search}</output>
}

describe('useLocationSearch', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		window.history.pushState({}, '', '/')
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

	it('tracks query-only navigation', () => {
		act(() => {
			root.render(<SearchProbe />)
		})
		expect(container.querySelector('output')?.textContent).toBe('')

		act(() => {
			navigate('/?filter=review')
		})

		expect(container.querySelector('output')?.textContent).toBe(
			'?filter=review',
		)
	})

	it('resyncs to the live location its mount effect would otherwise miss', () => {
		// Simulate a popstate that fired before the listener attached: change
		// the URL with a bare pushState (no popstate dispatched), then mount.
		// Without the in-effect resync the hook would render stale; with it the
		// fresh listener's catch-up read picks up the current search.
		window.history.pushState({}, '', '/?filter=failed')

		act(() => {
			root.render(<SearchProbe />)
		})

		expect(container.querySelector('output')?.textContent).toBe(
			'?filter=failed',
		)
	})
})
