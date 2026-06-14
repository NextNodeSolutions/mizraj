import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	activeSessionIdAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { useShellShortcuts } from './useShellShortcuts'

const store = getDefaultStore()

const Probe = (): React.JSX.Element => {
	useShellShortcuts()
	return <output>shortcuts live</output>
}

const pressGlobal = (init: KeyboardEventInit): KeyboardEvent => {
	const event = new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		...init,
	})
	window.dispatchEvent(event)
	return event
}

describe('useShellShortcuts', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(activeSessionIdAtom, null)
		window.history.pushState({}, '', '/')
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
	})

	it('jumps to each view on cmd+digit and claims the chord', () => {
		let event: KeyboardEvent | undefined
		act(() => {
			event = pressGlobal({ key: '3', metaKey: true })
		})
		expect(window.location.pathname).toBe('/pipeline')
		expect(event?.defaultPrevented).toBe(true)

		act(() => {
			pressGlobal({ key: '4', metaKey: true })
		})
		expect(window.location.pathname).toBe('/plans')

		act(() => {
			pressGlobal({ key: '5', metaKey: true })
		})
		expect(window.location.pathname).toBe('/review')

		act(() => {
			pressGlobal({ key: '1', metaKey: true })
		})
		expect(window.location.pathname).toBe('/')
	})

	it('honours ctrl as the modifier too', () => {
		act(() => {
			pressGlobal({ key: '3', ctrlKey: true })
		})

		expect(window.location.pathname).toBe('/pipeline')
	})

	it('sends cmd+2 to the cockpit target session', () => {
		act(() => {
			store.set(startSessionAtom, {
				id: 'sess-1',
				binary: 'claude',
				repoPath: '/repo',
			})
			store.set(activeSessionIdAtom, 'sess-1')
		})

		act(() => {
			pressGlobal({ key: '2', metaKey: true })
		})

		expect(window.location.pathname).toBe('/agent-run/sess-1')
	})

	it('sends cmd+2 to the empty cockpit without sessions', () => {
		act(() => {
			pressGlobal({ key: '2', metaKey: true })
		})

		expect(window.location.pathname).toBe('/agent-run')
	})

	it('ignores bare digits and other chords', () => {
		let event: KeyboardEvent | undefined
		act(() => {
			event = pressGlobal({ key: '3' })
		})
		expect(window.location.pathname).toBe('/')
		expect(event?.defaultPrevented).toBe(false)

		act(() => {
			event = pressGlobal({ key: '9', metaKey: true })
		})
		expect(window.location.pathname).toBe('/')
		expect(event?.defaultPrevented).toBe(false)
	})

	it('lets cmd+digit through while the caret is in an editable field', () => {
		const input = document.createElement('input')
		document.body.appendChild(input)
		input.focus()
		expect(document.activeElement).toBe(input)

		let event: KeyboardEvent | undefined
		act(() => {
			event = pressGlobal({ key: '3', metaKey: true })
		})

		// Typing isn't hijacked: no navigation, and the event stays unclaimed
		// so the field receives the keystroke.
		expect(window.location.pathname).toBe('/')
		expect(event?.defaultPrevented).toBe(false)

		input.remove()
	})

	it('stops handled chords before they reach deeper key routers', () => {
		const downstream = vi.fn()
		document.addEventListener('keydown', downstream)

		act(() => {
			document.body.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: '3',
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			)
		})

		document.removeEventListener('keydown', downstream)
		expect(window.location.pathname).toBe('/pipeline')
		expect(downstream).not.toHaveBeenCalled()
	})
})
