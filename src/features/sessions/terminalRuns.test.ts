import { describe, expect, it } from 'vitest'

import { coalesceTextRuns } from './terminalRuns'
import type { CellFramePayload, WireCell, WireColor } from './terminalWire'

const cell = (ch: string, overrides: Partial<WireCell> = {}): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
	...overrides,
})

const frame = (cells: WireCell[], cols = cells.length): CellFramePayload => ({
	session_id: 's',
	cols,
	rows: Math.max(1, Math.ceil(cells.length / cols)),
	cells,
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
})

const noSelection = (): boolean => false

describe('coalesceTextRuns', () => {
	it('joins same-style neighbours into one run', () => {
		const runs = coalesceTextRuns(
			frame([cell('='), cell('>'), cell(' '), cell('o'), cell('k')]),
			noSelection,
		)

		expect(runs).toHaveLength(1)
		expect(runs[0]).toMatchObject({
			row: 0,
			startCol: 0,
			text: '=> ok',
		})
	})

	it('breaks runs at style changes', () => {
		const red: WireColor = { kind: 'indexed', idx: 1 }
		const runs = coalesceTextRuns(
			frame([cell('a'), cell('b', { fg: red }), cell('c', { fg: red })]),
			noSelection,
		)

		expect(runs.map(r => r.text)).toEqual(['a', 'bc'])
		expect(runs[1]?.startCol).toBe(1)
	})

	it('breaks at attribute changes (bold ends a run)', () => {
		const runs = coalesceTextRuns(
			frame([cell('a'), cell('b', { attrs: 1 }), cell('c')]),
			noSelection,
		)

		expect(runs.map(r => r.text)).toEqual(['a', 'b', 'c'])
	})

	it('joins and breaks correctly for every fg color kind pair', () => {
		const indexed1: WireColor = { kind: 'indexed', idx: 1 }
		const indexed2: WireColor = { kind: 'indexed', idx: 2 }
		const rgbRed: WireColor = { kind: 'rgb', r: 255, g: 0, b: 0 }
		const rgbRedCopy: WireColor = { kind: 'rgb', r: 255, g: 0, b: 0 }
		const rgbBlue: WireColor = { kind: 'rgb', r: 0, g: 0, b: 255 }

		const cases: {
			name: string
			a: WireColor
			b: WireColor
			joined: boolean
		}[] = [
			{
				name: 'default/default',
				a: { kind: 'default' },
				b: { kind: 'default' },
				joined: true,
			},
			{
				name: 'indexed same idx',
				a: indexed1,
				b: indexed1,
				joined: true,
			},
			{
				name: 'indexed different idx',
				a: indexed1,
				b: indexed2,
				joined: false,
			},
			{
				name: 'rgb same channels',
				a: rgbRed,
				b: rgbRedCopy,
				joined: true,
			},
			{
				name: 'rgb different channels',
				a: rgbRed,
				b: rgbBlue,
				joined: false,
			},
			{
				name: 'default vs indexed',
				a: { kind: 'default' },
				b: indexed1,
				joined: false,
			},
			{
				name: 'default vs rgb',
				a: { kind: 'default' },
				b: rgbRed,
				joined: false,
			},
			{ name: 'indexed vs rgb', a: indexed1, b: rgbRed, joined: false },
		]

		for (const { name, a, b, joined } of cases) {
			const runs = coalesceTextRuns(
				frame([cell('a', { fg: a }), cell('b', { fg: b })]),
				noSelection,
			)
			expect(
				runs.map(r => r.text),
				name,
			).toEqual(joined ? ['ab'] : ['a', 'b'])
		}
	})

	it('isolates wide glyphs in their own run and skips spacers', () => {
		const runs = coalesceTextRuns(
			frame([
				cell('a'),
				cell('世', { wide: 'wide' }),
				cell('', { wide: 'spacer_tail' }),
				cell('b'),
			]),
			noSelection,
		)

		expect(runs.map(r => r.text)).toEqual(['a', '世', 'b'])
		expect(runs[1]).toMatchObject({ startCol: 1, span: 2 })
		expect(runs[2]?.startCol).toBe(3)
	})

	it('breaks runs at selection boundaries', () => {
		const runs = coalesceTextRuns(
			frame([cell('a'), cell('b'), cell('c')]),
			(col: number) => col === 1,
		)

		expect(runs.map(r => r.text)).toEqual(['a', 'b', 'c'])
		expect(runs[1]?.selected).toBe(true)
	})

	it('skips blank cells so empty space draws nothing', () => {
		const runs = coalesceTextRuns(
			frame([cell(' '), cell(' '), cell('x')]),
			noSelection,
		)

		expect(runs).toHaveLength(1)
		expect(runs[0]?.text).toBe('x')
		expect(runs[0]?.startCol).toBe(2)
	})
})
