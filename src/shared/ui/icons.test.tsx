import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	IconBoard,
	IconDiff,
	IconDoc,
	IconGear,
	IconGrid,
	IconPlus,
	IconTerm,
	IconX,
} from './icons'

const ICONS = [
	{ name: 'IconGrid', Icon: IconGrid },
	{ name: 'IconTerm', Icon: IconTerm },
	{ name: 'IconBoard', Icon: IconBoard },
	{ name: 'IconDoc', Icon: IconDoc },
	{ name: 'IconDiff', Icon: IconDiff },
	{ name: 'IconGear', Icon: IconGear },
	{ name: 'IconPlus', Icon: IconPlus },
	{ name: 'IconX', Icon: IconX },
]

describe('icons', () => {
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

	it.each(ICONS)('$name renders an 18x18 stroke-only svg', ({ Icon }) => {
		act(() => {
			root.render(<Icon />)
		})

		const svg = container.querySelector('svg')
		expect(svg?.getAttribute('viewBox')).toBe('0 0 18 18')
		expect(svg?.getAttribute('fill')).toBe('none')
		expect(svg?.getAttribute('stroke')).toBe('currentColor')
		expect(svg?.getAttribute('stroke-linecap')).toBe('round')
		expect(svg?.getAttribute('stroke-linejoin')).toBe('round')
	})

	it('strokes at 1.6 except the heavier plus', () => {
		act(() => {
			root.render(<IconGrid />)
		})
		expect(
			container.querySelector('svg')?.getAttribute('stroke-width'),
		).toBe('1.6')

		act(() => {
			root.render(<IconPlus />)
		})
		expect(
			container.querySelector('svg')?.getAttribute('stroke-width'),
		).toBe('1.8')
	})

	it('draws each glyph from its own geometry', () => {
		act(() => {
			root.render(<IconGrid />)
		})
		expect(container.querySelectorAll('svg rect')).toHaveLength(4)

		act(() => {
			root.render(<IconTerm />)
		})
		expect(container.querySelector('svg polyline')).not.toBeNull()

		act(() => {
			root.render(<IconGear />)
		})
		expect(container.querySelectorAll('svg line')).toHaveLength(8)
		expect(container.querySelector('svg circle')).not.toBeNull()
	})
})
