export type WireColor =
	| { kind: 'default' }
	| { kind: 'indexed'; idx: number }
	| { kind: 'rgb'; r: number; g: number; b: number }

export type WireCell = {
	ch: string
	fg: WireColor
	bg: WireColor
	attrs: number
}

export type CellFramePayload = {
	session_id: string
	cols: number
	rows: number
	cells: WireCell[]
}
