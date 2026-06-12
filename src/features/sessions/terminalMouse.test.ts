import { describe, expect, it } from 'vitest'

import {
	cellAtPoint,
	extractSelectionText,
	isCellSelected,
	normalizeSelection,
} from './terminalMouse'
import type { CellFramePayload, WireCell, WireCellWidth } from './terminalWire'

const metrics = { cellWidth: 10, lineHeight: 20 }
const grid = { cols: 8, rows: 4 }

const cell = (ch: string, wide: WireCellWidth = 'narrow'): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide,
})

describe('cellAtPoint', () => {
	it('maps a CSS pixel to its cell', () => {
		expect(cellAtPoint(25, 45, metrics, grid)).toEqual({ col: 2, row: 2 })
	})

	it('clamps outside coordinates to the grid edges', () => {
		expect(cellAtPoint(-5, -1, metrics, grid)).toEqual({ col: 0, row: 0 })
		expect(cellAtPoint(999, 999, metrics, grid)).toEqual({ col: 7, row: 3 })
	})
})

describe('isCellSelected', () => {
	// Linear (stream-order) selection from (row 1, col 6) to (row 2, col 1).
	const selection = normalizeSelection({
		anchor: { col: 6, row: 1 },
		head: { col: 1, row: 2 },
	})

	it('covers the span from anchor to head in stream order', () => {
		expect(isCellSelected(6, 1, selection)).toBe(true)
		expect(isCellSelected(7, 1, selection)).toBe(true)
		expect(isCellSelected(0, 2, selection)).toBe(true)
		expect(isCellSelected(1, 2, selection)).toBe(true)
	})

	it('excludes cells before the start and after the end', () => {
		expect(isCellSelected(5, 1, selection)).toBe(false)
		expect(isCellSelected(2, 2, selection)).toBe(false)
		expect(isCellSelected(0, 0, selection)).toBe(false)
		expect(isCellSelected(7, 3, selection)).toBe(false)
	})

	it('handles a backwards drag identically', () => {
		const backwards = normalizeSelection({
			anchor: { col: 1, row: 2 },
			head: { col: 6, row: 1 },
		})
		expect(backwards).toEqual(selection)
	})
})

describe('extractSelectionText', () => {
	const frame: CellFramePayload = {
		session_id: 's',
		cols: 3,
		rows: 2,
		cells: [
			cell('a'),
			cell('b'),
			cell('c'),
			cell('d'),
			cell('e'),
			cell(' '),
		],
		cursor: null,
		mouse_reporting: false,
		viewport_top: 0,
		history_total: 0,
	}

	it('joins the selected span with line breaks at row boundaries', () => {
		const text = extractSelectionText(
			frame,
			normalizeSelection({
				anchor: { col: 1, row: 0 },
				head: { col: 1, row: 1 },
			}),
		)

		expect(text).toBe('bc\nde')
	})

	it('trims trailing blanks per selected row', () => {
		const text = extractSelectionText(
			frame,
			normalizeSelection({
				anchor: { col: 0, row: 1 },
				head: { col: 2, row: 1 },
			}),
		)

		expect(text).toBe('de')
	})
})
