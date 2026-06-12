import { describe, expect, it } from 'vitest'

import { findLinkAt } from './terminalLinks'
import type { CellFramePayload, WireCell, WireCellWidth } from './terminalWire'

const cell = (ch: string, wide: WireCellWidth = 'narrow'): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide,
})

const rowFrame = (text: string): CellFramePayload => ({
	session_id: 's',
	cols: text.length,
	rows: 1,
	cells: [...text].map(ch => cell(ch)),
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
})

describe('findLinkAt', () => {
	it('finds the url under the pointer with its column span', () => {
		const frame = rowFrame('see https://mizraj.dev/docs now')

		const link = findLinkAt(frame, { col: 10, row: 0 })

		expect(link).toEqual({
			url: 'https://mizraj.dev/docs',
			row: 0,
			startCol: 4,
			endCol: 26,
		})
	})

	it('returns null outside any url', () => {
		const frame = rowFrame('see https://mizraj.dev/docs now')

		expect(findLinkAt(frame, { col: 2, row: 0 })).toBeNull()
		expect(findLinkAt(frame, { col: 29, row: 0 })).toBeNull()
	})

	it('strips trailing punctuation from detected urls', () => {
		const frame = rowFrame('(https://a.dev/x).')

		const link = findLinkAt(frame, { col: 5, row: 0 })

		expect(link?.url).toBe('https://a.dev/x')
		expect(link?.endCol).toBe(15)
	})

	it('maps columns correctly across wide cells', () => {
		// 世 occupies cols 0-1; the url starts at col 2.
		const cells = [
			cell('世', 'wide'),
			cell('', 'spacer_tail'),
			...[...'https://a.dev'].map(ch => cell(ch)),
		]
		const frame: CellFramePayload = {
			session_id: 's',
			cols: cells.length,
			rows: 1,
			cells,
			cursor: null,
			mouse_reporting: false,
			viewport_top: 0,
			history_total: 0,
		}

		const link = findLinkAt(frame, { col: 6, row: 0 })

		expect(link?.url).toBe('https://a.dev')
		expect(link?.startCol).toBe(2)
		expect(link?.endCol).toBe(14)
	})
})
