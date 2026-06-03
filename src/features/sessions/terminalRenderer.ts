import type { ResolvedFont } from './ghosttyConfig'
import { applyAdjustment } from './ghosttyConfig'
import { ATTR_TABLE, decodeAttrs, fontCss, fontFor } from './terminalAttrs'
import type { TerminalColors } from './terminalPalette'
import { brightenForBold, resolveColor } from './terminalPalette'
import type { CellFramePayload, WireCell, WireCellWidth } from './terminalWire'

const UNDERLINE_OFFSET_PX = 2
const UNDERLINE_THICKNESS_PX = 1
const STRIKE_CENTER_RATIO = 0.5
const DIM_ALPHA = 0.6
const FULL_ALPHA = 1

// Everything the renderer needs that comes from outside the cell stream, grouped
// by concern so later parity milestones bolt on without re-plumbing every
// signature: M0.5 filled `colors` + `font`; M1 adds `palette` (the resolved
// 256-entry table indexed colors resolve against) and `backgroundAlpha` (the
// Ghostty `background-opacity`, applied to background fills only). M3 adds cursor
// state. `colors` now carries the config bg/fg when present, else the CSS-var
// fallback (see useTerminalCanvas). `boldIsBright` is the Ghostty `bold-is-bright`
// directive: when set, a bold cell's standard ANSI foreground is drawn with its
// bright palette counterpart.
export type TerminalConfig = {
	colors: TerminalColors
	font: ResolvedFont
	palette: readonly string[]
	backgroundAlpha: number
	boldIsBright: boolean
}

type CellMetrics = {
	cellWidth: number
	lineHeight: number
}

export const measureCell = (
	context: CanvasRenderingContext2D,
	font: ResolvedFont,
): CellMetrics => {
	context.font = fontCss(font.regular, font.sizePx)
	const cellWidth = applyAdjustment(
		context.measureText('M').width,
		font.cellWidthAdjustment,
	)
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

// `span` is how many columns the cell occupies: 1 for a normal cell, 2 for a
// wide (CJK/emoji) glyph so its background, underline and strike cover both
// columns and the glyph is not clipped to one.
export const cellRect = (
	col: number,
	row: number,
	metrics: CellMetrics,
	span = 1,
): CellRect => {
	const x = Math.round(col * metrics.cellWidth)
	const y = Math.round(row * metrics.lineHeight)
	return {
		x,
		y,
		width: Math.round((col + span) * metrics.cellWidth) - x,
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
		brightenForBold(
			attrs.reverse ? cell.bg : cell.fg,
			attrs.bold,
			config.boldIsBright,
		),
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

// A wide glyph spans two columns; a narrow glyph one.
const WIDE_SPAN = 2

// Spacer cells hold no glyph: 'spacer_tail' is the second column of a wide glyph
// (already painted by the wide cell), 'spacer_head' pads a soft-wrapped line.
// Skipping them keeps a spacer's background from overpainting the wide glyph's
// right half.
const isSpacer = (wide: WireCellWidth): boolean =>
	wide === 'spacer_tail' || wide === 'spacer_head'

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
			if (isSpacer(cell.wide)) continue
			const span = cell.wide === 'wide' ? WIDE_SPAN : 1
			drawCell(
				context,
				cell,
				cellRect(col, row, metrics, span),
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
