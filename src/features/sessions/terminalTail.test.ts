import { describe, expect, it } from 'vitest'

import { terminalTail } from './terminalTail'
import type { CellFramePayload, WireCell } from './terminalWire'

const cell = (ch: string): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
})

const frameOfLines = (lines: ReadonlyArray<string>): CellFramePayload => {
	const cols = Math.max(...lines.map(line => line.length), 1)
	const cells = lines.flatMap(line =>
		Array.from({ length: cols }, (_, col) => cell(line[col] ?? ' ')),
	)
	return {
		session_id: 'sess-1',
		cols,
		rows: lines.length,
		cells,
		cursor: null,
		mouse_reporting: false,
		viewport_top: 0,
		history_total: 0,
	}
}

describe('terminalTail', () => {
	it('returns the last lines of the grid, most recent last', () => {
		const frame = frameOfLines(['one', 'two', 'three'])

		expect(terminalTail(frame, 2)).toEqual(['two', 'three'])
	})

	it('skips blank lines so prompts surrounded by padding stay visible', () => {
		const frame = frameOfLines(['pnpm install', '', 'done in 2s', ''])

		expect(terminalTail(frame, 2)).toEqual(['pnpm install', 'done in 2s'])
	})

	it('returns every line when the grid holds fewer than asked', () => {
		const frame = frameOfLines(['only'])

		expect(terminalTail(frame, 3)).toEqual(['only'])
	})

	it('returns no lines without a frame', () => {
		expect(terminalTail(undefined, 2)).toEqual([])
	})

	it('returns no lines for an all-blank grid', () => {
		expect(terminalTail(frameOfLines(['', '']), 2)).toEqual([])
	})
})
