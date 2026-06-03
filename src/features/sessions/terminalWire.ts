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

export type CellFramePayload = {
	session_id: string
	cols: number
	rows: number
	cells: WireCell[]
}
