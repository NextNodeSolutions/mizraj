import type { ResolvedFont } from './ghosttyConfig'

// Bit masks for the backend u8 attrs bitfield (bit positions 0..5).
const ATTR_BOLD = 0b00_0001
const ATTR_ITALIC = 0b00_0010
const ATTR_UNDERLINE = 0b00_0100
const ATTR_REVERSE = 0b00_1000
const ATTR_DIM = 0b01_0000
const ATTR_STRIKE = 0b10_0000

export type CellAttrs = {
	bold: boolean
	italic: boolean
	underline: boolean
	reverse: boolean
	dim: boolean
	strike: boolean
}

/* eslint-disable no-bitwise -- decodes the backend u8 attrs bitfield (BOLD..STRIKE); the wire format mandates bit math here */
export const decodeAttrs = (attrs: number): CellAttrs => ({
	bold: (attrs & ATTR_BOLD) !== 0,
	italic: (attrs & ATTR_ITALIC) !== 0,
	underline: (attrs & ATTR_UNDERLINE) !== 0,
	reverse: (attrs & ATTR_REVERSE) !== 0,
	dim: (attrs & ATTR_DIM) !== 0,
	strike: (attrs & ATTR_STRIKE) !== 0,
})
/* eslint-enable no-bitwise */

export const fontFor = (attrs: CellAttrs, font: ResolvedFont): string => {
	const weight = attrs.bold ? 'bold' : 'normal'
	const style = attrs.italic ? 'italic' : 'normal'
	return `${style} ${weight} ${font.sizePx}px ${font.familyCss}`
}

// `attrs` is a backend u8, so there are only 256 possible decodings. Decode them
// once at module load and index by the raw byte in the per-cell hot path,
// instead of allocating a fresh attrs object for every cell of every frame (tens
// of thousands per second during a heavy TUI redraw).
export const ATTR_TABLE: readonly CellAttrs[] = Array.from(
	{ length: 256 },
	(_, bits) => decodeAttrs(bits),
)

// Each font yields 256 possible CSS font strings (one per attrs byte). Building
// them per cell per frame would allocate in the hottest path, so the table is
// precomputed once per font and indexed by the raw attrs byte while drawing.
// The font is fixed for the lifetime of a startRendering call (it changes only
// on session/appearance change, which tears down the whole closure), so the
// caller builds this once there and threads it in alongside the metrics.
export const buildFontTable = (font: ResolvedFont): readonly string[] =>
	ATTR_TABLE.map(attrs => fontFor(attrs, font))
