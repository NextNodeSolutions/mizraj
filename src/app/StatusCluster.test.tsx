import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	endSessionAtom,
	sessionsAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'

import { StatusCluster } from './StatusCluster'

const store = getDefaultStore()

const startSession = (id: string): void => {
	store.set(startSessionAtom, { id, binary: 'claude', repoPath: '/repo' })
}

describe('StatusCluster', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		window.history.pushState({}, '', '/plans')
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

	const render = (): void => {
		act(() => {
			root.render(<StatusCluster />)
		})
	}

	it('counts running and to-review sessions separately', () => {
		startSession('run-1')
		startSession('run-2')
		startSession('done-1')
		store.set(endSessionAtom, { sessionId: 'done-1', exitCode: 0 })
		render()

		const [running, review] = Array.from(
			container.querySelectorAll('.mz-status .mz-statbtn'),
		)
		expect(running?.textContent).toContain('2')
		expect(running?.textContent).toContain('running')
		expect(review?.textContent).toContain('1')
		expect(review?.textContent).toContain('to review')
	})

	it('jumps to mission control filtered on running agents', () => {
		render()

		act(() => {
			container
				.querySelector<HTMLElement>('[title="Jump to running agents"]')
				?.click()
		})

		expect(window.location.pathname).toBe('/')
		expect(window.location.search).toBe('?filter=running')
	})

	it('jumps to mission control filtered on agents waiting for review', () => {
		render()

		act(() => {
			container
				.querySelector<HTMLElement>(
					'[title="Jump to agents waiting on you"]',
				)
				?.click()
		})

		expect(window.location.pathname).toBe('/')
		expect(window.location.search).toBe('?filter=review')
	})
})
