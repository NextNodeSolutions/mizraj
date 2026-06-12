import type { ResolvedCursor, ResolvedFont } from './ghosttyConfig'
import { applyAdjustment } from './ghosttyConfig'
import { ATTR_TABLE, decodeAttrs, fontCss, fontFor } from './terminalAttrs'
import type { GridLink } from './terminalLinks'
import { isCellSelected } from './terminalMouse'
import type { SelectionRange } from './terminalMouse'
import type { TerminalColors } from './terminalPalette'
import { brightenForBold, resolveColor } from './terminalPalette'
import { coalesceTextRuns } from './terminalRuns'
import type {
	CellFramePayload,
	WireCell,
	WireCellWidth,
	WireCursor,
	WireCursorStyle,
} from './terminalWire'

const UNDERLINE_OFFSET_PX = 2
const UNDERLINE_THICKNESS_PX = 1
const STRIKE_CENTER_RATIO = 0.5
const DIM_ALPHA = 0.6
const FULL_ALPHA = 1

// Cursor geometry: the bar's width and the underline's thickness, plus the
// stroke width of the hollow (unfocused) block.
const CURSOR_BAR_WIDTH_PX = 2
const CURSOR_UNDERLINE_HEIGHT_PX = 2
const CURSOR_HOLLOW_STROKE_PX = 1

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
	cursor: ResolvedCursor
	/// selection-background/-foreground from the config; null falls back to
	/// reverse video (swap the cell's resolved colors), Ghostty's default.
	selection: { background: string | null; foreground: string | null }
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

// The CSS font string for a cell's glyph: the precomputed per-attrs entry,
// falling back to building one for an attrs byte outside the table.
const glyphFont = (
	cell: WireCell,
	config: TerminalConfig,
	fontTable: readonly string[],
): string =>
	fontTable[cell.attrs] ??
	fontFor(ATTR_TABLE[cell.attrs] ?? decodeAttrs(cell.attrs), config.font)

// Reverse video swaps the cell's two colors AND the theme defaults each falls
// back to. Swapping only the sources collapses a default-on-default reversed
// cell — exactly how Ink/Claude Code draws its input cursor (`chalk.inverse`
// of a blank) — back to a normal cell, painting an invisible block. Swapping
// the fallbacks too makes it resolve to foreground-on-background, matching
// native Ghostty. A selected cell then takes the configured selection colors;
// without them the classic reverse video keeps the highlight visible anywhere.
const resolveCellColors = (
	cell: WireCell,
	config: TerminalConfig,
	selected: boolean,
): { background: string; foreground: string } => {
	const attrs = ATTR_TABLE[cell.attrs] ?? decodeAttrs(cell.attrs)
	const resolvedBackground = resolveColor(
		attrs.reverse ? cell.fg : cell.bg,
		attrs.reverse ? config.colors.foreground : config.colors.background,
		config.palette,
	)
	const resolvedForeground = resolveColor(
		brightenForBold(
			attrs.reverse ? cell.bg : cell.fg,
			attrs.bold,
			config.boldIsBright,
		),
		attrs.reverse ? config.colors.background : config.colors.foreground,
		config.palette,
	)
	if (!selected) {
		return {
			background: resolvedBackground,
			foreground: resolvedForeground,
		}
	}
	return {
		background: config.selection.background ?? resolvedForeground,
		foreground: config.selection.foreground ?? resolvedBackground,
	}
}

// Background and decorations only — glyphs are painted by the run pass in
// drawFrame so the shaper sees whole same-style stretches (ligatures, TP15).
const drawCell = (
	context: CanvasRenderingContext2D,
	cell: WireCell,
	rect: CellRect,
	config: TerminalConfig,
	fontTable: readonly string[],
	selected: boolean,
): void => {
	const attrs = ATTR_TABLE[cell.attrs] ?? decodeAttrs(cell.attrs)
	const { background, foreground } = resolveCellColors(cell, config, selected)

	// Default-background cells are already covered by clearToBackground; skipping
	// their fill avoids re-compositing the alpha layer (a wash at opacity < 1)
	// and cuts the per-frame fillRect count by the grid's blank majority.
	const paintsBackground =
		selected || attrs.reverse || cell.bg.kind !== 'default'
	if (paintsBackground) {
		// background-opacity dims the cell's background fill only; the glyph and
		// any underline/strike below stay fully opaque so text never washes out.
		context.globalAlpha = config.backgroundAlpha
		context.fillStyle = background
		context.fillRect(rect.x, rect.y, rect.width, rect.height)
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

// Draw one cursor shape into `rect` (color/alpha already set on the context): a
// thin left bar, a bottom underline, a hollow (unfocused) block outline, or a
// filled block.
const drawCursorShape = (
	context: CanvasRenderingContext2D,
	style: WireCursorStyle,
	rect: CellRect,
	color: string,
): void => {
	if (style === 'bar') {
		context.fillRect(rect.x, rect.y, CURSOR_BAR_WIDTH_PX, rect.height)
		return
	}
	if (style === 'underline') {
		context.fillRect(
			rect.x,
			rect.y + rect.height - CURSOR_UNDERLINE_HEIGHT_PX,
			rect.width,
			CURSOR_UNDERLINE_HEIGHT_PX,
		)
		return
	}
	if (style === 'block_hollow') {
		context.strokeStyle = color
		context.lineWidth = CURSOR_HOLLOW_STROKE_PX
		context.strokeRect(rect.x, rect.y, rect.width, rect.height)
		return
	}
	context.fillRect(rect.x, rect.y, rect.width, rect.height)
}

// Redraw the glyph a block cursor covers, in the invert color, so the character
// stays legible on the cursor block: cursor-text when configured, else the
// terminal background (classic reverse video). Skips empty cells.
const drawInvertedGlyph = (
	context: CanvasRenderingContext2D,
	cell: WireCell,
	rect: CellRect,
	config: TerminalConfig,
	fontTable: readonly string[],
): void => {
	if (cell.ch === ' ' || cell.ch === '') return
	context.fillStyle = config.cursor.textColor ?? config.colors.background
	context.font = glyphFont(cell, config, fontTable)
	context.fillText(cell.ch, rect.x, rect.y)
}

// Paint the cursor over the grid, after the cells. The config drives it: an
// explicit cursor-style overrides the frame's shape, cursor-color overrides the
// foreground default, and cursor-opacity dims the whole cursor. A block cursor
// also inverts the glyph it covers (`cellUnder`) so the character stays legible.
const drawCursor = (
	context: CanvasRenderingContext2D,
	cursor: WireCursor,
	cellUnder: WireCell | undefined,
	metrics: CellMetrics,
	config: TerminalConfig,
	fontTable: readonly string[],
): void => {
	const rect = cellRect(cursor.x, cursor.y, metrics)
	const style = config.cursor.style ?? cursor.style
	const color = config.cursor.color ?? config.colors.foreground

	context.globalAlpha = config.cursor.opacity
	context.fillStyle = color
	drawCursorShape(context, style, rect, color)
	if (style === 'block' && cellUnder) {
		drawInvertedGlyph(context, cellUnder, rect, config, fontTable)
	}
	context.globalAlpha = FULL_ALPHA
}

// The grid tiles at cellWidth but fillText advances at the font's natural
// width; with adjust-cell-width (or a fallback font) the two diverge and a
// single-run fillText drifts cumulatively off the grid — the cursor then sits
// visibly right of the text. Within this tolerance the run is drawn in one
// call (shaper ligatures intact); beyond it the advance is corrected.
const RUN_DRIFT_TOLERANCE_PX = 0.5

// Draw one run's text so each character lands on its grid column. Three paths,
// fastest first: a matching natural advance draws the whole run (ligatures
// form, zero extra cost); a mismatch is absorbed into letterSpacing when the
// engine supports it (ligatures survive, advance == cellWidth); else each char
// is placed at its own cell x — Ghostty's per-cell placement, minus shaping.
const fillRunText = (
	context: CanvasRenderingContext2D,
	text: string,
	startCol: number,
	rect: { x: number; y: number },
	metrics: CellMetrics,
): void => {
	const chars = [...text]
	if (chars.length <= 1) {
		context.fillText(text, rect.x, rect.y)
		return
	}
	const natural = context.measureText(text).width
	const target = chars.length * metrics.cellWidth
	if (Math.abs(natural - target) <= RUN_DRIFT_TOLERANCE_PX) {
		context.fillText(text, rect.x, rect.y)
		return
	}
	// letterSpacing (Safari 17.4+/WKWebView) absorbs the mismatch while the
	// shaper still sees the whole run; engines without it place per character.
	// Reflect.has, not `in`: lib.dom types the property unconditionally, so an
	// `in` check would narrow the no-support branch to `never`.
	if (Reflect.has(context, 'letterSpacing')) {
		context.letterSpacing = `${(target - natural) / chars.length}px`
		context.fillText(text, rect.x, rect.y)
		context.letterSpacing = '0px'
		return
	}
	for (const [index, char] of chars.entries()) {
		context.fillText(
			char,
			Math.round((startCol + index) * metrics.cellWidth),
			rect.y,
		)
	}
}

// Whether the cursor blinks for this frame. An explicit cursor-style-blink
// rules. Unset, Ghostty blinks the never-styled default cursor — but
// libghostty's wire collapses that default to block+steady, identical to an
// explicit DECSCUSR 2. The heuristic: a steady BLOCK reads as the default
// (blinks), a steady bar/underline as a deliberate DECSCUSR 4/6 (stays
// steady). Deviation for explicit steady-block requests, noted in the
// implementation notes.
export const cursorBlinks = (
	config: TerminalConfig,
	cursor: WireCursor,
): boolean => {
	if (config.cursor.blink !== null) return config.cursor.blink
	if (cursor.blink) return true
	return cursor.style === 'block'
}

// `cursorBlinkOn` is the blink phase for this paint (the caller's timer toggles
// it): a blinking cursor is drawn only while it is on, a steady cursor always.
// `selection` must already be normalized (anchor before head in stream order —
// normalizeSelection in terminalMouse); per-cell highlight rides drawCell.
export type DrawFrameOptions = {
	cursorBlinkOn?: boolean
	selection?: SelectionRange | null
	// The link under the pointer, underlined like Ghostty's hover affordance.
	hoveredLink?: GridLink | null
}

export const drawFrame = (
	context: CanvasRenderingContext2D,
	frame: CellFramePayload,
	metrics: CellMetrics,
	config: TerminalConfig,
	fontTable: readonly string[],
	options: DrawFrameOptions = {},
): void => {
	clearToBackground(context, config.colors.background, config.backgroundAlpha)
	context.textBaseline = 'top'
	const selection = options.selection ?? null

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
				selection ? isCellSelected(col, row, selection) : false,
			)
		}
	}

	// Glyph pass, by run: one fillText per same-style stretch lets the font
	// shaper form ligatures (=>, !=) exactly like Ghostty's harfbuzz pass,
	// while bg/selection/decorations above stayed per-cell.
	const runs = coalesceTextRuns(frame, (col, row) =>
		selection ? isCellSelected(col, row, selection) : false,
	)
	for (const run of runs) {
		const attrs = ATTR_TABLE[run.cell.attrs] ?? decodeAttrs(run.cell.attrs)
		const { foreground } = resolveCellColors(run.cell, config, run.selected)
		const rect = cellRect(run.startCol, run.row, metrics, run.span)
		context.globalAlpha = attrs.dim ? DIM_ALPHA : FULL_ALPHA
		context.fillStyle = foreground
		context.font = glyphFont(run.cell, config, fontTable)
		fillRunText(context, run.text, run.startCol, rect, metrics)
		context.globalAlpha = FULL_ALPHA
	}

	const hovered = options.hoveredLink
	if (hovered) {
		context.fillStyle = config.colors.foreground
		for (let col = hovered.startCol; col <= hovered.endCol; col += 1) {
			const rect = cellRect(col, hovered.row, metrics)
			context.fillRect(
				rect.x,
				rect.y + rect.height - UNDERLINE_OFFSET_PX,
				rect.width,
				UNDERLINE_THICKNESS_PX,
			)
		}
	}

	const cursor = frame.cursor
	const blinkOn = options.cursorBlinkOn ?? true
	if (
		cursor &&
		cursor.visible &&
		(!cursorBlinks(config, cursor) || blinkOn)
	) {
		const cellUnder = frame.cells[cursor.y * frame.cols + cursor.x]
		drawCursor(context, cursor, cellUnder, metrics, config, fontTable)
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
