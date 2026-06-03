export type WireColor =
	| { kind: 'default' }
	| { kind: 'indexed'; idx: number }
	| { kind: 'rgb'; r: number; g: number; b: number }

// Cell width, mirroring the backend WireCellWidth (libghostty GhosttyCellWide):
// a wide glyph spans two columns ('wide' carries it, 'spacer_tail' is the second
// column the renderer must not draw into); 'spacer_head' pads a soft-wrapped line.
export type WireCellWidth = 'narrow' | 'wide' | 'spacer_tail' | 'spacer_head'

export type WireCell = {
	ch: string
	fg: WireColor
	bg: WireColor
	attrs: number
	wide: WireCellWidth
}

// Cursor shape, mirroring the backend WireCursorStyle and the config's
// cursor-style vocabulary.
export type WireCursorStyle = 'block' | 'bar' | 'underline' | 'block_hollow'

// The cursor as the backend reports it for a frame: viewport position, shape,
// and the terminal's blink / visible modes. null when the cursor is scrolled out
// of the viewport (nothing to draw).
export type WireCursor = {
	x: number
	y: number
	style: WireCursorStyle
	blink: boolean
	visible: boolean
}

export type CellFramePayload = {
	session_id: string
	cols: number
	rows: number
	cells: WireCell[]
	cursor: WireCursor | null
}
