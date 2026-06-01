import { describe, expect, it } from 'vitest'

import { cellRect, gridForSize } from './terminalRenderer'

// Box-drawing borders disappeared because cells were placed at fractional
// `col * cellWidth` offsets, smearing 1px vertical strokes across two columns.
// cellRect snaps every edge to the device pixel grid; these tests lock that in.
// 7.83 is a realistic fractional monospace advance (measureText('M') at 13px).
const FRACTIONAL = { cellWidth: 7.83, lineHeight: 15.6 }

describe('cellRect', () => {
	it('snaps the origin of a fractional-width cell to whole pixels', () => {
		// col 3 raw x = 23.49 -> must round to 23, not stay fractional
		expect(cellRect(3, 0, FRACTIONAL)).toEqual({
			x: 23,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('tiles columns seamlessly: each cell starts where the previous ends', () => {
		const a = cellRect(5, 0, FRACTIONAL)
		const b = cellRect(6, 0, FRACTIONAL)

		expect(a.x + a.width).toBe(b.x)
	})

	it('tiles rows seamlessly: each cell starts where the row above ends', () => {
		const top = cellRect(0, 2, FRACTIONAL)
		const below = cellRect(0, 3, FRACTIONAL)

		expect(top.y + top.height).toBe(below.y)
	})

	it('keeps every edge on an integer pixel for a fractional metric', () => {
		const { x, y, width, height } = cellRect(7, 4, FRACTIONAL)

		expect(Number.isInteger(x)).toBe(true)
		expect(Number.isInteger(y)).toBe(true)
		expect(Number.isInteger(width)).toBe(true)
		expect(Number.isInteger(height)).toBe(true)
	})

	it('places the first cell at the origin', () => {
		expect(cellRect(0, 0, FRACTIONAL)).toEqual({
			x: 0,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('produces exact integer cells when the metric is already integral', () => {
		const integral = { cellWidth: 8, lineHeight: 16 }

		expect(cellRect(10, 5, integral)).toEqual({
			x: 80,
			y: 80,
			width: 8,
			height: 16,
		})
	})
})

describe('gridForSize', () => {
	const metrics = { cellWidth: 8, lineHeight: 16 }

	it('floors the box down to whole cells', () => {
		// 805px / 8 = 100.6 -> 100 cols; 410px / 16 = 25.6 -> 25 rows
		expect(gridForSize(805, 410, metrics)).toEqual({ cols: 100, rows: 25 })
	})

	it('clamps to a 1x1 grid when the box is smaller than a cell', () => {
		// A zero/tiny box must never yield 0 cols: that would break the backend
		// resize (ghostty rejects zero dimensions) and cell indexing.
		expect(gridForSize(0, 0, metrics)).toEqual({ cols: 1, rows: 1 })
		expect(gridForSize(3, 9, metrics)).toEqual({ cols: 1, rows: 1 })
	})

	it('is exact on cell-boundary sizes', () => {
		expect(gridForSize(80, 160, metrics)).toEqual({ cols: 10, rows: 10 })
	})
})
