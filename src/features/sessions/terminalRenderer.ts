import type { PaletteEntry, ResolvedFont } from './ghosttyConfig'

const UNDERLINE_OFFSET_PX = 2
const UNDERLINE_THICKNESS_PX = 1
const STRIKE_CENTER_RATIO = 0.5
const DIM_ALPHA = 0.6
const FULL_ALPHA = 1

// Bit masks for the backend u8 attrs bitfield (bit positions 0..5).
const ATTR_BOLD = 0b00_0001
const ATTR_ITALIC = 0b00_0010
const ATTR_UNDERLINE = 0b00_0100
const ATTR_REVERSE = 0b00_1000
const ATTR_DIM = 0b01_0000
const ATTR_STRIKE = 0b10_0000

const ANSI_16 = [
	'#000000',
	'#cd0000',
	'#00cd00',
	'#cdcd00',
	'#0000ee',
	'#cd00cd',
	'#00cdcd',
	'#e5e5e5',
	'#7f7f7f',
	'#ff0000',
	'#00ff00',
	'#ffff00',
	'#5c5cff',
	'#ff00ff',
	'#00ffff',
	'#ffffff',
] as const

const CUBE_BASE = 16
const CUBE_END = 231
const CUBE_STEP = 40
const CUBE_OFFSET = 55
const CUBE_SIDE = 6
const CUBE_PLANE = CUBE_SIDE * CUBE_SIDE
const PALETTE_MAX_INDEX = 255
const GRAYSCALE_BASE = 232
const GRAYSCALE_START = 8
const GRAYSCALE_STEP = 10

const cubeChannel = (level: number): number =>
	level === 0 ? 0 : CUBE_OFFSET + level * CUBE_STEP

// The standard xterm 256-color table: ANSI 16 + a 6x6x6 color cube (16..231) +
// a 24-step grayscale ramp (232..255). Indices 16..255 already match Ghostty's
// defaults exactly, so this is the base layer a theme's `palette` overrides sit
// on top of (a full theme only ships 0..15).
const buildXtermDefaults = (): readonly string[] => {
	const palette: string[] = [...ANSI_16]

	for (let idx = CUBE_BASE; idx <= CUBE_END; idx += 1) {
		const n = idx - CUBE_BASE
		const r = cubeChannel(Math.floor(n / CUBE_PLANE))
		const g = cubeChannel(Math.floor((n % CUBE_PLANE) / CUBE_SIDE))
		const b = cubeChannel(n % CUBE_SIDE)
		palette.push(`rgb(${r}, ${g}, ${b})`)
	}

	for (let idx = GRAYSCALE_BASE; idx <= PALETTE_MAX_INDEX; idx += 1) {
		const v = GRAYSCALE_START + (idx - GRAYSCALE_BASE) * GRAYSCALE_STEP
		palette.push(`rgb(${v}, ${v}, ${v})`)
	}

	return palette
}

const XTERM_PALETTE = buildXtermDefaults()

// The 256-entry palette the renderer actually indexes: the xterm defaults with
// the Ghostty config's `palette` overrides applied on top (override index wins,
// non-overridden indices keep the xterm default). Built once per config — like
// the font table — and threaded in via TerminalConfig, never rebuilt per frame.
// Out-of-range override indices are ignored so a bad config never grows the
// array past 256 or punches holes in it. Lives here because the xterm defaults
// it layers onto are the renderer's; the dependency stays renderer -> config
// (it only borrows the PaletteEntry type), never the reverse.
export const buildPalette = (
	overrides: readonly PaletteEntry[],
): readonly string[] => {
	const palette = [...XTERM_PALETTE]

	for (const { index, color } of overrides) {
		if (index < 0 || index > PALETTE_MAX_INDEX) continue
		palette[index] = color
	}

	return palette
}

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

// The two colors a cell's `Color::Default` resolves to. Passed in by the caller
// rather than hardcoded so the `--terminal-bg`/`--terminal-fg` CSS variables stay
// the single source of truth (see useTerminalCanvas).
export type TerminalColors = {
	background: string
	foreground: string
}

// Everything the renderer needs that comes from outside the cell stream, grouped
// by concern so later parity milestones bolt on without re-plumbing every
// signature: M0.5 filled `colors` + `font`; M1 adds `palette` (the resolved
// 256-entry table indexed colors resolve against) and `backgroundAlpha` (the
// Ghostty `background-opacity`, applied to background fills only). M3 adds cursor
// state. `colors` now carries the config bg/fg when present, else the CSS-var
// fallback (see useTerminalCanvas).
export type TerminalConfig = {
	colors: TerminalColors
	font: ResolvedFont
	palette: readonly string[]
	backgroundAlpha: number
}

type CellMetrics = {
	cellWidth: number
	lineHeight: number
}

type CellAttrs = {
	bold: boolean
	italic: boolean
	underline: boolean
	reverse: boolean
	dim: boolean
	strike: boolean
}

/* eslint-disable no-bitwise -- decodes the backend u8 attrs bitfield (BOLD..STRIKE); the wire format mandates bit math here */
const decodeAttrs = (attrs: number): CellAttrs => ({
	bold: (attrs & ATTR_BOLD) !== 0,
	italic: (attrs & ATTR_ITALIC) !== 0,
	underline: (attrs & ATTR_UNDERLINE) !== 0,
	reverse: (attrs & ATTR_REVERSE) !== 0,
	dim: (attrs & ATTR_DIM) !== 0,
	strike: (attrs & ATTR_STRIKE) !== 0,
})
/* eslint-enable no-bitwise */

// One resolver for both planes: the only difference is which theme color the
// terminal `default` resolves to, so the caller passes that as the fallback
// (also used when an indexed color is out of the 0..255 palette range). Indexed
// colors resolve against the per-config palette (xterm defaults + theme
// overrides), not the bare module-const defaults.
const resolveColor = (
	color: WireColor,
	fallback: string,
	palette: readonly string[],
): string => {
	if (color.kind === 'default') return fallback
	if (color.kind === 'rgb') return `rgb(${color.r}, ${color.g}, ${color.b})`
	return palette[color.idx] ?? fallback
}

const fontFor = (attrs: CellAttrs, font: ResolvedFont): string => {
	const weight = attrs.bold ? 'bold' : 'normal'
	const style = attrs.italic ? 'italic' : 'normal'
	return `${style} ${weight} ${font.sizePx}px ${font.familyCss}`
}

// `attrs` is a backend u8, so there are only 256 possible decodings. Decode them
// once at module load and index by the raw byte in the per-cell hot path,
// instead of allocating a fresh attrs object for every cell of every frame (tens
// of thousands per second during a heavy TUI redraw).
const ATTR_TABLE: readonly CellAttrs[] = Array.from(
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

export const measureCell = (
	context: CanvasRenderingContext2D,
	font: ResolvedFont,
): CellMetrics => {
	context.font = `normal normal ${font.sizePx}px ${font.familyCss}`
	const cellWidth = context.measureText('M').width
	const lineHeight = font.sizePx * font.lineHeightRatio
	return { cellWidth, lineHeight }
}

// Integer pixel bounds for the cell at (col, row). Cells tile off a fractional
// cellWidth/lineHeight, so we round each edge to the device pixel grid and take
// the next edge as the far side. This keeps cells seamless (no gap/overlap) AND
// lands thin vertical strokes — box-drawing `│ ╭ ╮ ╰ ╯` — on whole pixels.
// Without snapping, a 1px vertical glyph at a fractional x is smeared across two
// columns by anti-aliasing and effectively vanishes, while horizontals survive.
type CellRect = { x: number; y: number; width: number; height: number }

export const cellRect = (
	col: number,
	row: number,
	metrics: CellMetrics,
): CellRect => {
	const x = Math.round(col * metrics.cellWidth)
	const y = Math.round(row * metrics.lineHeight)
	return {
		x,
		y,
		width: Math.round((col + 1) * metrics.cellWidth) - x,
		height: Math.round((row + 1) * metrics.lineHeight) - y,
	}
}

const drawCell = (
	context: CanvasRenderingContext2D,
	cell: WireCell,
	rect: CellRect,
	config: TerminalConfig,
	fontTable: readonly string[],
): void => {
	const attrs = ATTR_TABLE[cell.attrs] ?? decodeAttrs(cell.attrs)
	const background = resolveColor(
		attrs.reverse ? cell.fg : cell.bg,
		config.colors.background,
		config.palette,
	)
	const foreground = resolveColor(
		attrs.reverse ? cell.bg : cell.fg,
		config.colors.foreground,
		config.palette,
	)

	// background-opacity dims the cell's background fill only; the glyph and any
	// underline/strike below stay fully opaque so text never washes out.
	context.globalAlpha = config.backgroundAlpha
	context.fillStyle = background
	context.fillRect(rect.x, rect.y, rect.width, rect.height)
	context.globalAlpha = FULL_ALPHA

	if (cell.ch !== ' ' && cell.ch !== '') {
		context.globalAlpha = attrs.dim ? DIM_ALPHA : FULL_ALPHA
		context.fillStyle = foreground
		context.font = fontTable[cell.attrs] ?? fontFor(attrs, config.font)
		context.fillText(cell.ch, rect.x, rect.y)
		context.globalAlpha = FULL_ALPHA
	}

	if (attrs.underline) {
		context.fillStyle = foreground
		context.fillRect(
			rect.x,
			rect.y + rect.height - UNDERLINE_OFFSET_PX,
			rect.width,
			UNDERLINE_THICKNESS_PX,
		)
	}

	if (attrs.strike) {
		context.fillStyle = foreground
		context.fillRect(
			rect.x,
			rect.y + Math.round(rect.height * STRIKE_CENTER_RATIO),
			rect.width,
			UNDERLINE_THICKNESS_PX,
		)
	}
}

// Paint the whole backing store with the default background at the configured
// background-opacity. The context is scaled by devicePixelRatio for crisp text,
// so we drop to the identity transform first and fill in physical pixels —
// filling `canvas.width` under the scaled transform would overshoot the canvas
// by the DPR factor. `save`/`restore` also rolls back the alpha so the rest of
// the frame draws fully opaque.
const clearToBackground = (
	context: CanvasRenderingContext2D,
	background: string,
	alpha: number,
): void => {
	const { canvas } = context
	context.save()
	context.setTransform(1, 0, 0, 1, 0, 0)
	context.globalAlpha = alpha
	context.fillStyle = background
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.restore()
}

export const drawFrame = (
	context: CanvasRenderingContext2D,
	frame: CellFramePayload,
	metrics: CellMetrics,
	config: TerminalConfig,
	fontTable: readonly string[],
): void => {
	clearToBackground(context, config.colors.background, config.backgroundAlpha)
	context.textBaseline = 'top'

	for (let row = 0; row < frame.rows; row += 1) {
		for (let col = 0; col < frame.cols; col += 1) {
			const cell = frame.cells[row * frame.cols + col]
			if (!cell) continue
			drawCell(
				context,
				cell,
				cellRect(col, row, metrics),
				config,
				fontTable,
			)
		}
	}
}

// Grid dimensions (whole cells) that fit a CSS-pixel box. The terminal grid
// only changes at cell boundaries, so this is the value the backend resize
// keys off — sub-cell drag noise leaves it unchanged.
export const gridForSize = (
	width: number,
	height: number,
	metrics: CellMetrics,
): { cols: number; rows: number } => ({
	cols: Math.max(1, Math.floor(width / metrics.cellWidth)),
	rows: Math.max(1, Math.floor(height / metrics.lineHeight)),
})

// Size the backing store to a CSS box at the current devicePixelRatio and put
// the context in CSS-pixel coordinates. Idempotent: when the device dimensions
// already match it leaves the bitmap untouched, because assigning canvas.width
// always clears the canvas — even to the same value. Callers paint immediately
// after, so the clear that a genuine resize triggers is never seen. Display
// (CSS) sizing is intentionally NOT done here: during a live resize the element
// is stretched over the old bitmap as a hold-frame, and the backing store only
// catches up once a freshly reflowed frame is ready to paint crisply.
export const syncBackingStore = (
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	cssWidth: number,
	cssHeight: number,
): void => {
	const ratio = window.devicePixelRatio || 1
	const deviceWidth = Math.floor(cssWidth * ratio)
	const deviceHeight = Math.floor(cssHeight * ratio)
	if (canvas.width === deviceWidth && canvas.height === deviceHeight) return
	canvas.width = deviceWidth
	canvas.height = deviceHeight
	context.setTransform(ratio, 0, 0, ratio, 0, 0)
}
