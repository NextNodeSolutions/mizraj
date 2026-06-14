import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { toastsAtom } from '@/shared/toasts'

import { Toasts } from './Toasts'

const store = getDefaultStore()

describe('Toasts', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(toastsAtom, [])
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

	it('renders nothing while no toast is live', () => {
		act(() => {
			root.render(<Toasts />)
		})

		expect(container.querySelector('.toast')).toBeNull()
	})

	it('announces a live toast with its check glyph', () => {
		act(() => {
			root.render(<Toasts />)
		})
		act(() => {
			store.set(toastsAtom, [{ id: 1, message: 'Agent lancé' }])
		})

		const toast = container.querySelector('.toast')
		expect(toast?.getAttribute('role')).toBe('status')
		expect(toast?.getAttribute('data-show')).toBe('true')
		expect(toast?.querySelector('.tk')?.textContent).toBe('✓')
		expect(toast?.textContent).toContain('Agent lancé')
	})

	it('stacks concurrent toasts in the viewport', () => {
		act(() => {
			root.render(<Toasts />)
		})
		act(() => {
			store.set(toastsAtom, [
				{ id: 1, message: 'first' },
				{ id: 2, message: 'second' },
			])
		})

		const messages = Array.from(
			container.querySelectorAll('.toast-viewport .toast'),
		).map(toast => toast.textContent)
		expect(messages).toEqual(['✓first', '✓second'])
	})
})
