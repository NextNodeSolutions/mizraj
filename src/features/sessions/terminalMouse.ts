import type { CellFramePayload } from './terminalWire'

// One grid coordinate (column, row), the unit every mouse consumer works in.
export type CellPoint = { col: number; row: number }

// A drag selection: where the press anchored and where the pointer is. The
// raw anchor/head pair is direction-sensitive; normalizeSelection orders it.
export type SelectionRange = { anchor: CellPoint; head: CellPoint }

type GridSize = { cols: number; rows: number }

type Metrics = { cellWidth: number; lineHeight: number }

// The single pixel→cell conversion (TP12): CSS-pixel offsets relative to the
// canvas (the context is DPR-scaled, so CSS px are the drawing unit; the
// window padding lives OUTSIDE the canvas as container padding and never
// enters this math). Clamped so drags past the edges select to the border.
export const cellAtPoint = (
	x: number,
	y: number,
	metrics: Metrics,
	grid: GridSize,
): CellPoint => ({
	col: Math.min(
		grid.cols - 1,
		Math.max(0, Math.floor(x / metrics.cellWidth)),
	),
	row: Math.min(
		grid.rows - 1,
		Math.max(0, Math.floor(y / metrics.lineHeight)),
	),
})

const streamOrder = (point: CellPoint, cols: number): number =>
	point.row * cols + point.col

// Order anchor/head into stream order so a backwards drag selects the same
// span. Uses a fixed large stride instead of the live column count: only the
// relative order matters and it is stable for any realistic grid width.
const ORDER_STRIDE = 100_000

export const normalizeSelection = (range: SelectionRange): SelectionRange => {
	const anchorOrder = streamOrder(range.anchor, ORDER_STRIDE)
	const headOrder = streamOrder(range.head, ORDER_STRIDE)
	return anchorOrder <= headOrder
		? range
		: { anchor: range.head, head: range.anchor }
}

// Whether (col, row) falls inside the normalized selection, in linear stream
// order (a terminal selection follows the text flow, not a rectangle).
export const isCellSelected = (
	col: number,
	row: number,
	selection: SelectionRange,
): boolean => {
	const order = streamOrder({ col, row }, ORDER_STRIDE)
	return (
		order >= streamOrder(selection.anchor, ORDER_STRIDE) &&
		order <= streamOrder(selection.head, ORDER_STRIDE)
	)
}

// The selected span as plain text: stream order, line breaks at row
// boundaries, trailing blanks trimmed per row, wide-glyph spacers skipped.
export const extractSelectionText = (
	frame: CellFramePayload,
	selection: SelectionRange,
): string => {
	const rows: string[] = []
	for (let row = selection.anchor.row; row <= selection.head.row; row += 1) {
		const first = row === selection.anchor.row ? selection.anchor.col : 0
		const last =
			row === selection.head.row ? selection.head.col : frame.cols - 1
		let line = ''
		for (let col = first; col <= last; col += 1) {
			const cell = frame.cells[row * frame.cols + col]
			if (!cell) continue
			if (cell.wide === 'spacer_tail' || cell.wide === 'spacer_head') {
				continue
			}
			line += cell.ch
		}
		rows.push(line.replace(/\s+$/, ''))
	}
	return rows.join('\n')
}
