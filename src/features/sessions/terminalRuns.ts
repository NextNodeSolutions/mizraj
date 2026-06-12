import type { CellFramePayload, WireCell } from './terminalWire'

// A horizontal stretch of same-style cells drawn with ONE fillText, so the
// font shaper sees the whole string and can form ligatures (TP15). Only the
// glyph pass coalesces — background, selection highlight, decorations and the
// cursor stay per-cell.
export type TextRun = {
	row: number
	startCol: number
	text: string
	/// Columns the run's single glyph spans — 2 for an isolated wide glyph,
	/// otherwise one column per character of `text`.
	span: number
	/// Style source: the first cell of the run (same fg/attrs across it).
	cell: WireCell
	selected: boolean
}

const isBlank = (cell: WireCell): boolean => cell.ch === ' ' || cell.ch === ''

// Wide glyphs and multi-codepoint grapheme clusters break the 1 char = 1
// column invariant a shaped run relies on; they draw alone.
const standsAlone = (cell: WireCell): boolean =>
	cell.wide === 'wide' || [...cell.ch].length > 1

const sameStyle = (a: WireCell, b: WireCell): boolean =>
	a.attrs === b.attrs && JSON.stringify(a.fg) === JSON.stringify(b.fg)

type OpenRun = {
	startCol: number
	text: string
	cell: WireCell
	selected: boolean
	pendingBlanks: string
}

// Walk the grid row by row and group contiguous same-style, same-selection
// cells into runs. Blanks never start a run, are absorbed between same-style
// glyphs (they carry the spacing inside the single fillText) and are trimmed
// from the tail.
export const coalesceTextRuns = (
	frame: CellFramePayload,
	isSelected: (col: number, row: number) => boolean,
): TextRun[] => {
	const runs: TextRun[] = []

	for (let row = 0; row < frame.rows; row += 1) {
		let open: OpenRun | null = null

		const flush = (): void => {
			if (open && open.text.length > 0) {
				runs.push({
					row,
					startCol: open.startCol,
					text: open.text,
					span: open.text.length,
					cell: open.cell,
					selected: open.selected,
				})
			}
			open = null
		}

		for (let col = 0; col < frame.cols; col += 1) {
			const cell = frame.cells[row * frame.cols + col]
			if (
				!cell ||
				cell.wide === 'spacer_tail' ||
				cell.wide === 'spacer_head'
			) {
				continue
			}
			const selected = isSelected(col, row)

			if (isBlank(cell)) {
				if (open) open.pendingBlanks += ' '
				continue
			}

			if (standsAlone(cell)) {
				flush()
				runs.push({
					row,
					startCol: col,
					text: cell.ch,
					span: cell.wide === 'wide' ? 2 : 1,
					cell,
					selected,
				})
				continue
			}

			const joinable =
				open !== null &&
				open.selected === selected &&
				sameStyle(open.cell, cell) &&
				// Pending blanks must keep char↔column alignment: the gap the
				// blanks cover equals their count by construction.
				open.startCol + open.text.length + open.pendingBlanks.length ===
					col

			if (open && joinable) {
				open.text += open.pendingBlanks + cell.ch
				open.pendingBlanks = ''
				continue
			}

			flush()
			open = {
				startCol: col,
				text: cell.ch,
				cell,
				selected,
				pendingBlanks: '',
			}
		}
		flush()
	}

	return runs
}
