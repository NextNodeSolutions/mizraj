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

	it('announces live toasts politely', () => {
		act(() => {
			root.render(<Toasts />)
		})
		act(() => {
			store.set(toastsAtom, [{ id: 1, message: 'Agent lancé' }])
		})

		const viewport = container.querySelector('[role="status"]')
		expect(viewport?.getAttribute('aria-live')).toBe('polite')
		expect(viewport?.textContent).toContain('Agent lancé')
	})
})
