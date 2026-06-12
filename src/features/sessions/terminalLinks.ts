import type { CellPoint } from './terminalMouse'
import type { CellFramePayload } from './terminalWire'

// A detected link and the column span it occupies on its row — what the hover
// underline paints and the cmd-click opens (TP9).
export type GridLink = {
	url: string
	row: number
	startCol: number
	endCol: number
}

// The URL shapes worth detecting in terminal output. Trailing punctuation
// (sentence period, closing paren/bracket, comma…) is not part of the link.
const URL_PATTERN = /(?:https?|file):\/\/[^\s]+|mailto:[^\s]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

type RowProjection = {
	text: string
	// Column of each character in `text` (wide glyphs take 2 columns, their
	// spacer contributes no character).
	colOf: number[]
}

const projectRow = (frame: CellFramePayload, row: number): RowProjection => {
	let text = ''
	const colOf: number[] = []
	for (let col = 0; col < frame.cols; col += 1) {
		const cell = frame.cells[row * frame.cols + col]
		if (!cell) continue
		if (cell.wide === 'spacer_tail' || cell.wide === 'spacer_head') {
			continue
		}
		for (const ch of cell.ch === '' ? ' ' : cell.ch) {
			text += ch
			colOf.push(col)
		}
	}
	return { text, colOf }
}

// The link under (col, row), if any: the row's text is scanned for URLs and
// the match containing the pointer's character wins. Pure — callers cache the
// result per cell to keep hover repaints cheap.
export const findLinkAt = (
	frame: CellFramePayload,
	point: CellPoint,
): GridLink | null => {
	if (point.row < 0 || point.row >= frame.rows) return null
	const { text, colOf } = projectRow(frame, point.row)

	for (const match of text.matchAll(URL_PATTERN)) {
		const url = match[0].replace(TRAILING_PUNCTUATION, '')
		if (url.length === 0) continue
		const start = match.index
		const end = start + url.length - 1

		const startCol = colOf[start]
		const endCol = colOf[end]
		if (startCol === undefined || endCol === undefined) continue

		if (point.col >= startCol && point.col <= endCol) {
			return { url, row: point.row, startCol, endCol }
		}
	}
	return null
}
