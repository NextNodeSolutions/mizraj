import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DiffStat, Panel, PanelHead, SDot, StatusTag } from './atoms'

describe('atoms', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
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

	const render = (element: React.JSX.Element): void => {
		act(() => {
			root.render(element)
		})
	}

	describe('SDot', () => {
		it('renders the status as a dot variant class', () => {
			render(<SDot s="run" />)

			expect(container.querySelector('span.sdot.sdot-run')).not.toBeNull()
		})

		it('covers the review variant', () => {
			render(<SDot s="rev" />)

			expect(container.querySelector('span.sdot.sdot-rev')).not.toBeNull()
		})
	})

	describe('StatusTag', () => {
		it('labels a running session with the run variant', () => {
			render(<StatusTag status="running" />)

			const tag = container.querySelector('.tag.tag-run')
			expect(tag?.textContent).toBe('running')
		})

		it('labels an ended-clean session as needing review', () => {
			render(<StatusTag status="review" />)

			const tag = container.querySelector('.tag.tag-rev')
			expect(tag?.textContent).toBe('needs review')
		})

		it('labels a failed session with the fail variant', () => {
			render(<StatusTag status="failed" />)

			const tag = container.querySelector('.tag.tag-fail')
			expect(tag?.textContent).toBe('failed')
		})
	})

	describe('DiffStat', () => {
		it('shows additions, deletions and the file count', () => {
			render(<DiffStat add={12} del={3} files={4} />)

			const stat = container.querySelector('.stat')
			expect(stat?.textContent).toBe('+12 −3 · 4 files')
			expect(stat?.querySelector('.add')?.textContent).toBe('+12')
			expect(stat?.querySelector('.del')?.textContent).toBe('−3')
		})

		it('hides deletions at zero and files when not provided', () => {
			render(<DiffStat add={5} del={0} />)

			const stat = container.querySelector('.stat')
			expect(stat?.textContent).toBe('+5')
			expect(stat?.querySelector('.del')).toBeNull()
		})
	})

	describe('Panel', () => {
		it('wraps its children in a panel surface with extra classes', () => {
			render(
				<Panel className="fc-sess">
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section.panel.fc-sess')
			expect(panel?.textContent).toBe('body')
		})

		it('is a plain panel without a class', () => {
			render(
				<Panel>
					<p>body</p>
				</Panel>,
			)

			const panel = container.querySelector('section')
			expect(panel?.className).toBe('panel')
		})
	})

	describe('PanelHead', () => {
		it('titles the panel and shows the count', () => {
			render(<PanelHead title="Sessions" count={3} />)

			const head = container.querySelector('header.panel-head')
			expect(head?.querySelector('h3')?.textContent).toBe('Sessions')
			expect(head?.querySelector('.ph-count')?.textContent).toBe('3')
		})

		it('omits the count and hosts trailing actions', () => {
			render(
				<PanelHead title="Diffs">
					<button type="button">act</button>
				</PanelHead>,
			)

			const head = container.querySelector('header.panel-head')
			expect(head?.querySelector('.ph-count')).toBeNull()
			expect(head?.querySelector('button')?.textContent).toBe('act')
		})

		it('leads with the modularity grip affordance', () => {
			render(<PanelHead title="Sessions" />)

			const grip = container.querySelector('header.panel-head .grip')
			expect(grip?.getAttribute('title')).toBe('Drag to rearrange module')
			expect(grip?.getAttribute('aria-hidden')).toBe('true')
			expect(grip?.querySelectorAll('i')).toHaveLength(6)
		})
	})
})
