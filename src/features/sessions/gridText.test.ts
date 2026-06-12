import { describe, expect, it } from 'vitest'

import { extractGridText } from './gridText'
import type { CellFramePayload, WireCell, WireCellWidth } from './terminalWire'

const cell = (ch: string, wide: WireCellWidth = 'narrow'): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide,
})

const frame = (
	cols: number,
	rows: number,
	cells: WireCell[],
): CellFramePayload => ({
	session_id: 'sess-1',
	cols,
	rows,
	cells,
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
})

describe('extractGridText', () => {
	it('joins rows with newlines and trims trailing blanks per row', () => {
		const text = extractGridText(
			frame(3, 2, [
				cell('h'),
				cell('i'),
				cell(' '),
				cell('y'),
				cell('o'),
				cell(' '),
			]),
		)

		expect(text).toBe('hi\nyo')
	})

	it('keeps interior blanks', () => {
		const text = extractGridText(
			frame(3, 1, [cell('a'), cell(' '), cell('b')]),
		)

		expect(text).toBe('a b')
	})

	it('skips wide-cell spacers so CJK copies once', () => {
		const text = extractGridText(
			frame(3, 1, [
				cell('世', 'wide'),
				cell('', 'spacer_tail'),
				cell('!'),
			]),
		)

		expect(text).toBe('世!')
	})

	it('drops fully blank trailing rows', () => {
		const text = extractGridText(
			frame(2, 3, [
				cell('o'),
				cell('k'),
				cell(' '),
				cell(' '),
				cell(' '),
				cell(' '),
			]),
		)

		expect(text).toBe('ok')
	})

	it('returns an empty string for an empty frame', () => {
		expect(extractGridText(frame(0, 0, []))).toBe('')
	})
})
