import type { CellFramePayload } from './terminalWire'

// Extract the visible grid as plain text, the shape select-all/copy put on the
// clipboard: spacer cells of wide glyphs are skipped (the glyph already covers
// both columns), each row loses its trailing blanks, and blank trailing rows
// are dropped so an idle prompt doesn't copy a page of padding.
export const extractGridText = (frame: CellFramePayload): string => {
	const rows: string[] = []
	for (let row = 0; row < frame.rows; row += 1) {
		let line = ''
		for (let col = 0; col < frame.cols; col += 1) {
			const cell = frame.cells[row * frame.cols + col]
			if (!cell) continue
			if (cell.wide === 'spacer_tail' || cell.wide === 'spacer_head') {
				continue
			}
			line += cell.ch
		}
		rows.push(line.replace(/\s+$/, ''))
	}
	while (rows.length > 0 && rows[rows.length - 1] === '') {
		rows.pop()
	}
	return rows.join('\n')
}
