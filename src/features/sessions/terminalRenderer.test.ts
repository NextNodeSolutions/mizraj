import { describe, expect, it, vi } from 'vitest'

import type { ResolvedCursor, ResolvedFont } from './ghosttyConfig'
import {
	applyAdjustment,
	DEFAULT_FONT_STACK,
	EMPTY_CONFIG,
	resolveBackgroundAlpha,
	resolveCursor,
	resolveFont,
} from './ghosttyConfig'
import { buildFontTable } from './terminalAttrs'
import { buildPalette } from './terminalPalette'
import type { DrawFrameOptions, TerminalConfig } from './terminalRenderer'
import {
	cellRect,
	drawFrame,
	gridForSize,
	measureCell,
} from './terminalRenderer'
import type {
	CellFramePayload,
	WireCell,
	WireCursor,
	WireCursorStyle,
} from './terminalWire'

// Box-drawing borders disappeared because cells were placed at fractional
// `col * cellWidth` offsets, smearing 1px vertical strokes across two columns.
// cellRect snaps every edge to the device pixel grid; these tests lock that in.
// 7.83 is a realistic fractional monospace advance (measureText('M') at 13px).
const FRACTIONAL = { cellWidth: 7.83, lineHeight: 15.6 }

describe('cellRect', () => {
	it('snaps the origin of a fractional-width cell to whole pixels', () => {
		// col 3 raw x = 23.49 -> must round to 23, not stay fractional
		expect(cellRect(3, 0, FRACTIONAL)).toEqual({
			x: 23,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('tiles columns seamlessly: each cell starts where the previous ends', () => {
		const a = cellRect(5, 0, FRACTIONAL)
		const b = cellRect(6, 0, FRACTIONAL)

		expect(a.x + a.width).toBe(b.x)
	})

	it('tiles rows seamlessly: each cell starts where the row above ends', () => {
		const top = cellRect(0, 2, FRACTIONAL)
		const below = cellRect(0, 3, FRACTIONAL)

		expect(top.y + top.height).toBe(below.y)
	})

	it('keeps every edge on an integer pixel for a fractional metric', () => {
		const { x, y, width, height } = cellRect(7, 4, FRACTIONAL)

		expect(Number.isInteger(x)).toBe(true)
		expect(Number.isInteger(y)).toBe(true)
		expect(Number.isInteger(width)).toBe(true)
		expect(Number.isInteger(height)).toBe(true)
	})

	it('places the first cell at the origin', () => {
		expect(cellRect(0, 0, FRACTIONAL)).toEqual({
			x: 0,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('produces exact integer cells when the metric is already integral', () => {
		const integral = { cellWidth: 8, lineHeight: 16 }

		expect(cellRect(10, 5, integral)).toEqual({
			x: 80,
			y: 80,
			width: 8,
			height: 16,
		})
	})

	it('spans a wide cell across two columns when span is 2', () => {
		const integral = { cellWidth: 8, lineHeight: 16 }

		// col 0 over two columns: width covers 2 cells (16), height one row.
		expect(cellRect(0, 0, integral, 2)).toEqual({
			x: 0,
			y: 0,
			width: 16,
			height: 16,
		})
	})
})

describe('gridForSize', () => {
	const metrics = { cellWidth: 8, lineHeight: 16 }

	it('floors the box down to whole cells', () => {
		// 805px / 8 = 100.6 -> 100 cols; 410px / 16 = 25.6 -> 25 rows
		expect(gridForSize(805, 410, metrics)).toEqual({ cols: 100, rows: 25 })
	})

	it('clamps to a 1x1 grid when the box is smaller than a cell', () => {
		// A zero/tiny box must never yield 0 cols: that would break the backend
		// resize (ghostty rejects zero dimensions) and cell indexing.
		expect(gridForSize(0, 0, metrics)).toEqual({ cols: 1, rows: 1 })
		expect(gridForSize(3, 9, metrics)).toEqual({ cols: 1, rows: 1 })
	})

	it('is exact on cell-boundary sizes', () => {
		expect(gridForSize(80, 160, metrics)).toEqual({ cols: 10, rows: 10 })
	})
})

describe('resolveFont', () => {
	it('falls back to the built-in 13px/1.2 mono stack with synthetic variants when the config is empty', () => {
		expect(resolveFont(EMPTY_CONFIG)).toEqual({
			regular: {
				familyCss: DEFAULT_FONT_STACK,
				weight: 'normal',
				style: 'normal',
			},
			bold: {
				familyCss: DEFAULT_FONT_STACK,
				weight: 'bold',
				style: 'normal',
			},
			italic: {
				familyCss: DEFAULT_FONT_STACK,
				weight: 'normal',
				style: 'italic',
			},
			boldItalic: {
				familyCss: DEFAULT_FONT_STACK,
				weight: 'bold',
				style: 'italic',
			},
			sizePx: 13,
			lineHeightRatio: 1.2,
			cellWidthAdjustment: null,
		})
	})

	it('prepends configured families to the default stack as a fallback chain', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['MonoLisa', 'JetBrains Mono'],
		})

		expect(font.regular.familyCss).toBe(
			`MonoLisa, JetBrains Mono, ${DEFAULT_FONT_STACK}`,
		)
	})

	it('draws an explicit bold family verbatim at normal weight', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['Reg'],
			font_family_bold: ['Reg Bold'],
		})

		expect(font.bold).toEqual({
			familyCss: `Reg Bold, ${DEFAULT_FONT_STACK}`,
			weight: 'normal',
			style: 'normal',
		})
	})

	it('synthesizes bold on the regular family when no bold family is configured', () => {
		const font = resolveFont({ ...EMPTY_CONFIG, font_family: ['Reg'] })

		expect(font.bold).toEqual({
			familyCss: `Reg, ${DEFAULT_FONT_STACK}`,
			weight: 'bold',
			style: 'normal',
		})
	})

	it('falls a bold-italic cell back to the bold family with synthetic italic', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['Reg'],
			font_family_bold: ['Reg Bold'],
		})

		expect(font.boldItalic).toEqual({
			familyCss: `Reg Bold, ${DEFAULT_FONT_STACK}`,
			weight: 'normal',
			style: 'italic',
		})
	})

	it('uses an explicit bold-italic family verbatim when configured', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['Reg'],
			font_family_bold: ['Reg Bold'],
			font_family_bold_italic: ['Reg Bold Italic'],
		})

		expect(font.boldItalic).toEqual({
			familyCss: `Reg Bold Italic, ${DEFAULT_FONT_STACK}`,
			weight: 'normal',
			style: 'normal',
		})
	})

	it('uses the configured font size', () => {
		expect(resolveFont({ ...EMPTY_CONFIG, font_size: 16 }).sizePx).toBe(16)
	})

	it('carries adjust-cell-width through for measureCell to apply', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			adjust_cell_width: { kind: 'percent', value: 10 },
		})

		expect(font.cellWidthAdjustment).toEqual({ kind: 'percent', value: 10 })
	})

	it('scales the line-height ratio by a percent adjust-cell-height', () => {
		// 10% taller cells -> 1.2 * 1.10 = 1.32
		const font = resolveFont({
			...EMPTY_CONFIG,
			adjust_cell_height: { kind: 'percent', value: 10 },
		})

		expect(font.lineHeightRatio).toBeCloseTo(1.32, 5)
	})

	it('turns an absolute adjust-cell-height into a ratio of the font size', () => {
		// size 13 -> natural line box 13 * 1.2 = 15.6; +4px = 19.6; /13 = ~1.5077
		const font = resolveFont({
			...EMPTY_CONFIG,
			adjust_cell_height: { kind: 'absolute', value: 4 },
		})

		expect(font.lineHeightRatio).toBeCloseTo(19.6 / 13, 5)
	})

	it('measures an absolute adjustment against the configured size, not 13', () => {
		// size 20 -> natural 24; +6px = 30; /20 = 1.5
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_size: 20,
			adjust_cell_height: { kind: 'absolute', value: 6 },
		})

		expect(font.lineHeightRatio).toBeCloseTo(1.5, 5)
	})
})

// jsdom has no 2d canvas backend (no native `canvas` package), so the real
// rendering context is unavailable. We fake exactly the two surfaces measureCell
// touches: the `font` setter and `measureText`. measureText returns a width keyed
// off the set font so the test can prove the metric is computed from the FONT IT
// WAS GIVEN, not a frozen module constant.
const fakeContextMeasuringEm = (
	advancePerPx: number,
): { context: CanvasRenderingContext2D; setFont: ReturnType<typeof vi.fn> } => {
	const setFont = vi.fn<(value: string) => void>()
	const measureText = vi.fn(() => {
		const match = setFont.mock.lastCall?.[0]?.match(/(\d+)px/)
		const sizePx = match ? Number(match[1]) : 0
		return { width: sizePx * advancePerPx }
	})
	const context = {
		set font(value: string) {
			setFont(value)
		},
		measureText,
	}
	// @ts-expect-error - deliberate partial CanvasRenderingContext2D double;
	// jsdom cannot provide a real 2d context, and measureCell reads only the
	// `font` setter and `measureText` member faked here.
	return { context, setFont }
}

// A uniform ResolvedFont (every variant on the same family) for tests that only
// care about size/family/lineHeight, not per-variant resolution.
const monoFont = (
	familyCss: string,
	sizePx: number,
	lineHeightRatio: number,
): ResolvedFont => {
	const variant = { familyCss, weight: 'normal', style: 'normal' } as const
	return {
		regular: variant,
		bold: variant,
		italic: variant,
		boldItalic: variant,
		sizePx,
		lineHeightRatio,
		cellWidthAdjustment: null,
	}
}

describe('measureCell', () => {
	it('sets a plain (normal/normal) font string from the resolved regular family', () => {
		const { context, setFont } = fakeContextMeasuringEm(0.6)

		measureCell(context, monoFont('JetBrains Mono', 16, 1.5))

		expect(setFont).toHaveBeenCalledWith(
			'normal normal 16px JetBrains Mono',
		)
	})

	it('derives lineHeight as sizePx * lineHeightRatio of the passed font', () => {
		const { context } = fakeContextMeasuringEm(0.6)

		const metrics = measureCell(
			context,
			monoFont('JetBrains Mono', 20, 1.4),
		)

		expect(metrics.lineHeight).toBeCloseTo(28, 5)
	})

	it('measures cellWidth at the passed font size, not a fixed default', () => {
		const { context } = fakeContextMeasuringEm(0.6)

		const big = measureCell(context, monoFont('JetBrains Mono', 26, 1.2))

		// 26px * 0.6 advance = 15.6: proof the width tracks the given size.
		expect(big.cellWidth).toBeCloseTo(15.6, 5)
	})

	it('applies a percent adjust-cell-width to the measured natural width', () => {
		const { context } = fakeContextMeasuringEm(0.6)
		const font: ResolvedFont = {
			...monoFont('JetBrains Mono', 16, 1.5),
			cellWidthAdjustment: { kind: 'percent', value: 50 },
		}

		// natural 16 * 0.6 = 9.6, +50% = 14.4
		expect(measureCell(context, font).cellWidth).toBeCloseTo(14.4, 5)
	})

	it('applies an absolute adjust-cell-width as a pixel delta', () => {
		const { context } = fakeContextMeasuringEm(0.6)
		const font: ResolvedFont = {
			...monoFont('JetBrains Mono', 16, 1.5),
			cellWidthAdjustment: { kind: 'absolute', value: 4 },
		}

		// natural 16 * 0.6 = 9.6, +4px = 13.6
		expect(measureCell(context, font).cellWidth).toBeCloseTo(13.6, 5)
	})
})

describe('applyAdjustment', () => {
	it('returns the natural value when there is no adjustment', () => {
		expect(applyAdjustment(8, null)).toBe(8)
	})

	it('scales by a percent adjustment', () => {
		// 8 + 25% = 10
		expect(applyAdjustment(8, { kind: 'percent', value: 25 })).toBeCloseTo(
			10,
			5,
		)
	})

	it('adds an absolute pixel delta', () => {
		expect(applyAdjustment(8, { kind: 'absolute', value: 3 })).toBe(11)
	})

	it('shrinks the value on a negative absolute delta', () => {
		expect(applyAdjustment(8, { kind: 'absolute', value: -2 })).toBe(6)
	})
})

// Catppuccin Latte fragments used as realistic, hardcoded expected values: a
// light theme overrides the default ANSI 0/15 (black/white) with its own beige
// and ink, so an `indexed` cell color must resolve to the OVERRIDE, not the
// xterm default.
const LATTE_BG = '#eff1f5'
const LATTE_FG = '#4c4f69'
const LATTE_ANSI_15 = '#dce0e8'

describe('resolveBackgroundAlpha', () => {
	it.each([
		{ background_opacity: null, expected: 1, label: 'null -> opaque' },
		{
			background_opacity: 0.95,
			expected: 0.95,
			label: 'fraction passes through',
		},
		{ background_opacity: 1, expected: 1, label: '1 -> opaque' },
		{ background_opacity: 1.5, expected: 1, label: '>1 clamps to opaque' },
		{
			background_opacity: 0,
			expected: 1,
			label: '0 -> opaque (never invisible)',
		},
		{ background_opacity: -0.2, expected: 1, label: 'negative -> opaque' },
	])('$label', ({ background_opacity, expected }) => {
		expect(
			resolveBackgroundAlpha({ ...EMPTY_CONFIG, background_opacity }),
		).toBe(expected)
	})
})

// A recording 2d-context double for the paint path. drawFrame/drawCell set
// `fillStyle`/`globalAlpha` as properties and THEN call fillRect/fillText, so we
// snapshot the active style+alpha at the moment of each paint into an ordered
// log. This lets the tests assert on observable output (what got painted, in
// which color, at which alpha) without touching renderer internals. jsdom has no
// real 2d backend, so a fake is the only option here.
type Paint = {
	op: 'rect' | 'text' | 'stroke'
	fillStyle: string
	alpha: number
	x: number
	y: number
	width: number
	height: number
	text?: string
}

const recordingContext = (): {
	context: CanvasRenderingContext2D
	paints: Paint[]
} => {
	const paints: Paint[] = []
	const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1 }
	const context = {
		canvas: { width: 800, height: 600 },
		set fillStyle(value: string) {
			state.fillStyle = value
		},
		set strokeStyle(value: string) {
			state.strokeStyle = value
		},
		set globalAlpha(value: number) {
			state.globalAlpha = value
		},
		set font(_value: string) {},
		set textBaseline(_value: string) {},
		set lineWidth(_value: number) {},
		save() {},
		restore() {},
		setTransform() {},
		fillRect(x: number, y: number, width: number, height: number) {
			paints.push({
				op: 'rect',
				fillStyle: state.fillStyle,
				alpha: state.globalAlpha,
				x,
				y,
				width,
				height,
			})
		},
		strokeRect(x: number, y: number, width: number, height: number) {
			paints.push({
				op: 'stroke',
				fillStyle: state.strokeStyle,
				alpha: state.globalAlpha,
				x,
				y,
				width,
				height,
			})
		},
		fillText(text: string, x: number, y: number) {
			paints.push({
				op: 'text',
				fillStyle: state.fillStyle,
				alpha: state.globalAlpha,
				x,
				y,
				width: 0,
				height: 0,
				text,
			})
		},
	}
	// @ts-expect-error - deliberate partial CanvasRenderingContext2D double;
	// jsdom cannot provide a real 2d context, and drawFrame touches only the
	// members faked here (fill/stroke style + globalAlpha + lineWidth setters,
	// save/restore/setTransform, fillRect/strokeRect/fillText, canvas dimensions).
	return { context, paints }
}

const INTEGRAL_METRICS = { cellWidth: 8, lineHeight: 16 }

// A single non-blank cell whose fg/bg are both `default`, so they resolve to the
// config's default colors and the test isolates the bg/fg fallback + opacity.
const defaultColorCell: WireCell = {
	ch: 'A',
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
}

const oneCellFrame = (cell: WireCell): CellFramePayload => ({
	session_id: 'sess-1',
	cols: 1,
	rows: 1,
	cells: [cell],
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
})

const cursorConfigWith = (
	overrides: Partial<ResolvedCursor>,
): ResolvedCursor => ({
	color: null,
	textColor: null,
	style: null,
	opacity: 1,
	...overrides,
})

const configWith = (overrides: Partial<TerminalConfig>): TerminalConfig => ({
	colors: { background: LATTE_BG, foreground: LATTE_FG },
	font: resolveFont(EMPTY_CONFIG),
	palette: buildPalette([]),
	backgroundAlpha: 1,
	boldIsBright: false,
	cursor: cursorConfigWith({}),
	selection: { background: null, foreground: null },
	...overrides,
})

describe('drawFrame color resolution', () => {
	it('paints a default-colored cell with the config bg and fg', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({}),
			fontTable,
		)

		const cellBg = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_BG,
		)
		const glyph = paints.find(p => p.op === 'text')
		expect(cellBg?.fillStyle).toBe(LATTE_BG)
		expect(glyph?.fillStyle).toBe(LATTE_FG)
	})

	it('draws a bold standard-ANSI fg with its bright counterpart when bold-is-bright is on', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		// ATTR byte 1 = BOLD. fg index 1 (xterm red #cd0000) must resolve to its
		// bright counterpart index 9 (#ff0000) once bold-is-bright is enabled.
		const boldRedCell: WireCell = {
			ch: 'A',
			fg: { kind: 'indexed', idx: 1 },
			bg: { kind: 'default' },
			attrs: 1,
			wide: 'narrow',
		}

		drawFrame(
			context,
			oneCellFrame(boldRedCell),
			INTEGRAL_METRICS,
			configWith({ boldIsBright: true }),
			fontTable,
		)

		const glyph = paints.find(p => p.op === 'text')
		expect(glyph?.fillStyle).toBe('#ff0000')
	})

	it('leaves a bold standard-ANSI fg at its normal color when bold-is-bright is off', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		const boldRedCell: WireCell = {
			ch: 'A',
			fg: { kind: 'indexed', idx: 1 },
			bg: { kind: 'default' },
			attrs: 1,
			wide: 'narrow',
		}

		drawFrame(
			context,
			oneCellFrame(boldRedCell),
			INTEGRAL_METRICS,
			configWith({ boldIsBright: false }),
			fontTable,
		)

		const glyph = paints.find(p => p.op === 'text')
		expect(glyph?.fillStyle).toBe('#cd0000')
	})

	it('resolves an indexed fg against the config palette override, not the xterm default', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		// ANSI index 15 (default xterm white #ffffff) overridden by Latte's #dce0e8.
		const indexedCell: WireCell = {
			ch: 'A',
			fg: { kind: 'indexed', idx: 15 },
			bg: { kind: 'default' },
			attrs: 0,
			wide: 'narrow',
		}

		drawFrame(
			context,
			oneCellFrame(indexedCell),
			INTEGRAL_METRICS,
			configWith({
				palette: buildPalette([{ index: 15, color: LATTE_ANSI_15 }]),
			}),
			fontTable,
		)

		const glyph = paints.find(p => p.op === 'text')
		expect(glyph?.fillStyle).toBe(LATTE_ANSI_15)
	})

	// Claude Code (Ink) hides the OS cursor and draws its own as a reverse-video
	// blank — `chalk.inverse(' ')` — so the input cursor reaches us as a cell with
	// default fg/bg and the REVERSE attr. Reverse must swap the default fallbacks,
	// not just the color sources, or the block collapses to the normal cell colors
	// and the cursor is invisible. ATTR byte 8 = REVERSE (bit 3).
	it("paints a reverse default cell as a visible block (Claude's cursor): fg fills the bg, bg paints the glyph", () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		const reverseDefaultCell: WireCell = {
			ch: 'A',
			fg: { kind: 'default' },
			bg: { kind: 'default' },
			attrs: 0b00_1000,
			wide: 'narrow',
		}

		drawFrame(
			context,
			oneCellFrame(reverseDefaultCell),
			INTEGRAL_METRICS,
			configWith({}),
			fontTable,
		)

		const block = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_FG,
		)
		const glyph = paints.find(p => p.op === 'text')
		expect(block?.fillStyle).toBe(LATTE_FG)
		expect(glyph?.fillStyle).toBe(LATTE_BG)
	})

	it('paints a reverse default BLANK cell as a visible block with no glyph (cursor at end of input)', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		const reverseBlankCell: WireCell = {
			ch: ' ',
			fg: { kind: 'default' },
			bg: { kind: 'default' },
			attrs: 0b00_1000,
			wide: 'narrow',
		}

		drawFrame(
			context,
			oneCellFrame(reverseBlankCell),
			INTEGRAL_METRICS,
			configWith({}),
			fontTable,
		)

		const block = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_FG,
		)
		expect(block?.fillStyle).toBe(LATTE_FG)
		expect(paints.find(p => p.op === 'text')).toBeUndefined()
	})
})

describe('drawFrame background-opacity', () => {
	it('applies the alpha to the cell background fill but not the glyph', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({ backgroundAlpha: 0.95 }),
			fontTable,
		)

		const cellBg = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_BG,
		)
		const glyph = paints.find(p => p.op === 'text')
		expect(cellBg?.alpha).toBe(0.95)
		expect(glyph?.alpha).toBe(1)
	})

	it('applies the alpha to the full-canvas clear fill', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({ backgroundAlpha: 0.95 }),
			fontTable,
		)

		// the very first paint is clearToBackground over the whole backing store.
		const clearFill = paints[0]
		expect(clearFill?.op).toBe('rect')
		expect(clearFill?.fillStyle).toBe(LATTE_BG)
		expect(clearFill?.alpha).toBe(0.95)
	})

	it('paints fully opaque when the alpha is 1', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({ backgroundAlpha: 1 }),
			fontTable,
		)

		const cellBg = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_BG,
		)
		expect(cellBg?.alpha).toBe(1)
	})
})

const wideCell = (ch: string): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'wide',
})

const spacerTailCell: WireCell = {
	ch: ' ',
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'spacer_tail',
}

describe('drawFrame wide cells and graphemes', () => {
	it('paints a wide glyph across two columns and skips its spacer tail', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		const frame: CellFramePayload = {
			session_id: 'sess-1',
			cols: 2,
			rows: 1,
			cells: [wideCell('中'), spacerTailCell],
			cursor: null,
			mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
		}

		drawFrame(context, frame, INTEGRAL_METRICS, configWith({}), fontTable)

		// Exactly one glyph painted (the wide char): the spacer drew nothing.
		const glyphs = paints.filter(p => p.op === 'text')
		expect(glyphs).toHaveLength(1)
		expect(glyphs[0]?.text).toBe('中')

		// The wide cell's background spans two cells (2 * cellWidth 8 = 16).
		const wideBg = paints.find(
			p => p.op === 'rect' && p.x === 0 && p.width === 16,
		)
		expect(wideBg).toBeDefined()

		// No cell paint starts at the spacer's column (x = 8): it was skipped.
		expect(paints.some(p => p.x === 8)).toBe(false)
	})

	it.each(['spacer_tail', 'spacer_head'] as const)(
		'skips a %s spacer cell entirely (only the canvas clear paints)',
		wide => {
			const { context, paints } = recordingContext()
			const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
			const spacer: WireCell = {
				ch: ' ',
				fg: { kind: 'default' },
				bg: { kind: 'default' },
				attrs: 0,
				wide,
			}
			const frame: CellFramePayload = {
				session_id: 'sess-1',
				cols: 1,
				rows: 1,
				cells: [spacer],
				cursor: null,
				mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
			}

			drawFrame(
				context,
				frame,
				INTEGRAL_METRICS,
				configWith({}),
				fontTable,
			)

			expect(paints.filter(p => p.op === 'text')).toHaveLength(0)
			// Only clearToBackground's full-canvas rect; no per-cell background.
			expect(paints.filter(p => p.op === 'rect')).toHaveLength(1)
		},
	)

	it('draws a multi-codepoint grapheme cluster as a single glyph string', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		// 'e' + U+0301 combining acute: must reach fillText whole, not truncated.
		const clusterCell: WireCell = {
			ch: 'é',
			fg: { kind: 'default' },
			bg: { kind: 'default' },
			attrs: 0,
			wide: 'narrow',
		}
		const frame: CellFramePayload = {
			session_id: 'sess-1',
			cols: 1,
			rows: 1,
			cells: [clusterCell],
			cursor: null,
			mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
		}

		drawFrame(context, frame, INTEGRAL_METRICS, configWith({}), fontTable)

		const glyph = paints.find(p => p.op === 'text')
		expect(glyph?.text).toBe('é')
	})
})

const spaceCell: WireCell = {
	ch: ' ',
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
}

const cursorAt = (
	style: WireCursorStyle,
	visible = true,
	blink = false,
): WireCursor => ({
	x: 0,
	y: 0,
	style,
	blink,
	visible,
})

// A non-blank cell at the cursor's position, so the invert pass has a glyph to
// redraw over the block.
const glyphCell = (ch: string): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
})

describe('drawFrame selection', () => {
	const selectionOf = (col: number, row: number): DrawFrameOptions => ({
		selection: { anchor: { col, row }, head: { col, row } },
	})

	it('paints a selected cell with the configured selection colors', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({
				selection: { background: '#123456', foreground: '#abcdef' },
			}),
			fontTable,
			selectionOf(0, 0),
		)

		const cellBg = paints.find(
			p => p.op === 'rect' && p.fillStyle === '#123456',
		)
		const glyph = paints.find(p => p.op === 'text')
		expect(cellBg).toBeDefined()
		expect(glyph?.fillStyle).toBe('#abcdef')
	})

	it('falls back to reverse video without configured selection colors', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({}),
			fontTable,
			selectionOf(0, 0),
		)

		const cellBg = paints.find(
			p => p.op === 'rect' && p.fillStyle === LATTE_FG,
		)
		const glyph = paints.find(p => p.op === 'text')
		expect(cellBg).toBeDefined()
		expect(glyph?.fillStyle).toBe(LATTE_BG)
	})

	it('leaves cells outside the selection untouched', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({
				selection: { background: '#123456', foreground: '#abcdef' },
			}),
			fontTable,
			{ selection: { anchor: { col: 3, row: 2 }, head: { col: 5, row: 2 } } },
		)

		const glyph = paints.find(p => p.op === 'text')
		expect(glyph?.fillStyle).toBe(LATTE_FG)
	})
})

describe('drawFrame hovered link', () => {
	it('underlines the hovered span in the foreground color', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))

		drawFrame(
			context,
			oneCellFrame(defaultColorCell),
			INTEGRAL_METRICS,
			configWith({}),
			fontTable,
			{
				hoveredLink: { url: 'https://a.dev', row: 0, startCol: 0, endCol: 0 },
			},
		)

		const underline = paints.find(
			p =>
				p.op === 'rect' &&
				p.fillStyle === LATTE_FG &&
				p.height === 1 &&
				p.y === 14,
		)
		expect(underline).toBeDefined()
	})
})

describe('drawFrame cursor', () => {
	// A single space cell paints only its LATTE_BG background and no glyph, so the
	// only non-LATTE_BG paint in the log is the cursor itself.
	const cursorPaints = (
		cursor: WireCursor | null,
		cursorConfig: ResolvedCursor = cursorConfigWith({}),
		options: DrawFrameOptions = {},
		cell: WireCell = spaceCell,
	): Paint[] => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		const frame: CellFramePayload = {
			session_id: 'sess-1',
			cols: 1,
			rows: 1,
			cells: [cell],
			cursor,
			mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
		}
		drawFrame(
			context,
			frame,
			INTEGRAL_METRICS,
			configWith({ cursor: cursorConfig }),
			fontTable,
			options,
		)
		return paints
	}

	it('fills the whole cell for a block cursor in the foreground color', () => {
		const cursor = cursorPaints(cursorAt('block')).find(
			p => p.fillStyle === LATTE_FG,
		)

		expect(cursor).toMatchObject({
			op: 'rect',
			x: 0,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('draws a thin left bar for a bar cursor', () => {
		const cursor = cursorPaints(cursorAt('bar')).find(
			p => p.fillStyle === LATTE_FG,
		)

		expect(cursor).toMatchObject({
			op: 'rect',
			x: 0,
			y: 0,
			width: 2,
			height: 16,
		})
	})

	it('draws a bottom underline for an underline cursor', () => {
		const cursor = cursorPaints(cursorAt('underline')).find(
			p => p.fillStyle === LATTE_FG,
		)

		// cell height 16, underline thickness 2 -> sits at y = 14.
		expect(cursor).toMatchObject({
			op: 'rect',
			x: 0,
			y: 14,
			width: 8,
			height: 2,
		})
	})

	it('strokes an outline for a hollow block cursor', () => {
		const cursor = cursorPaints(cursorAt('block_hollow')).find(
			p => p.fillStyle === LATTE_FG,
		)

		expect(cursor).toMatchObject({
			op: 'stroke',
			x: 0,
			y: 0,
			width: 8,
			height: 16,
		})
	})

	it('does not draw a hidden cursor', () => {
		expect(
			cursorPaints(cursorAt('block', false)).find(
				p => p.fillStyle === LATTE_FG,
			),
		).toBeUndefined()
	})

	it('does not draw when there is no cursor', () => {
		expect(
			cursorPaints(null).find(p => p.fillStyle === LATTE_FG),
		).toBeUndefined()
	})

	it('paints with the config cursor-color instead of the foreground', () => {
		const cursor = cursorPaints(
			cursorAt('block'),
			cursorConfigWith({ color: '#ff8800' }),
		).find(p => p.fillStyle === '#ff8800')

		expect(cursor).toMatchObject({ op: 'rect', x: 0, width: 8 })
	})

	it('lets the config cursor-style override the frame shape', () => {
		// Frame reports a block, but the config forces a bar (thin left rect).
		const cursor = cursorPaints(
			cursorAt('block'),
			cursorConfigWith({ style: 'bar' }),
		).find(p => p.fillStyle === LATTE_FG)

		expect(cursor).toMatchObject({ op: 'rect', width: 2, height: 16 })
	})

	it('dims the cursor by the config cursor-opacity', () => {
		const cursor = cursorPaints(
			cursorAt('block'),
			cursorConfigWith({ opacity: 0.5 }),
		).find(p => p.fillStyle === LATTE_FG)

		expect(cursor?.alpha).toBe(0.5)
	})

	// Visibility = visible AND (steady OR blink-phase-on). The truth table:
	it.each([
		{
			label: 'blinking cursor hidden during the off phase',
			blink: true,
			blinkOn: false,
			drawn: false,
		},
		{
			label: 'blinking cursor shown during the on phase',
			blink: true,
			blinkOn: true,
			drawn: true,
		},
		{
			label: 'steady cursor shown regardless of phase',
			blink: false,
			blinkOn: false,
			drawn: true,
		},
	])('$label', ({ blink, blinkOn, drawn }) => {
		const cursor = cursorPaints(
			cursorAt('block', true, blink),
			cursorConfigWith({}),
			{ cursorBlinkOn: blinkOn },
		).find(p => p.fillStyle === LATTE_FG)

		expect(Boolean(cursor)).toBe(drawn)
	})

	it('inverts the glyph under a block cursor to the background by default', () => {
		const glyphs = cursorPaints(
			cursorAt('block'),
			cursorConfigWith({}),
			{},
			glyphCell('A'),
		).filter(p => p.op === 'text' && p.text === 'A')

		// The cell paints 'A' in the foreground; the cursor invert redraws it in
		// the background on top, so the last 'A' is the inverted one.
		expect(glyphs.at(-1)?.fillStyle).toBe(LATTE_BG)
	})

	it('inverts using cursor-text when configured', () => {
		const glyphs = cursorPaints(
			cursorAt('block'),
			cursorConfigWith({ textColor: '#abcdef' }),
			{},
			glyphCell('A'),
		).filter(p => p.op === 'text' && p.text === 'A')

		expect(glyphs.at(-1)?.fillStyle).toBe('#abcdef')
	})

	it('does not invert the glyph under a non-block cursor', () => {
		const glyphs = cursorPaints(
			cursorAt('bar'),
			cursorConfigWith({}),
			{},
			glyphCell('A'),
		).filter(p => p.op === 'text' && p.text === 'A')

		// Only the cell's own foreground glyph; a bar does not cover or invert it.
		expect(glyphs).toHaveLength(1)
		expect(glyphs[0]?.fillStyle).toBe(LATTE_FG)
	})
})

describe('resolveCursor', () => {
	it('defaults to no overrides and full opacity for an empty config', () => {
		expect(resolveCursor(EMPTY_CONFIG)).toEqual({
			color: null,
			textColor: null,
			style: null,
			opacity: 1,
		})
	})

	it('passes a hex cursor-color through', () => {
		expect(
			resolveCursor({ ...EMPTY_CONFIG, cursor_color: '#ff0000' }).color,
		).toBe('#ff0000')
	})

	it('drops a non-CSS cursor-color sentinel to null (foreground fallback)', () => {
		expect(
			resolveCursor({ ...EMPTY_CONFIG, cursor_color: 'cell-foreground' })
				.color,
		).toBeNull()
	})

	it('carries cursor-text for the invert color', () => {
		expect(
			resolveCursor({ ...EMPTY_CONFIG, cursor_text: '#000000' })
				.textColor,
		).toBe('#000000')
	})

	it('accepts a known cursor-style and rejects an unknown one', () => {
		expect(
			resolveCursor({ ...EMPTY_CONFIG, cursor_style: 'bar' }).style,
		).toBe('bar')
		expect(
			resolveCursor({ ...EMPTY_CONFIG, cursor_style: 'beam' }).style,
		).toBeNull()
	})

	it.each([
		{ cursor_opacity: null, expected: 1, label: 'null -> opaque' },
		{
			cursor_opacity: 0.4,
			expected: 0.4,
			label: 'fraction passes through',
		},
		{ cursor_opacity: 0, expected: 0, label: '0 -> invisible' },
		{ cursor_opacity: 1.5, expected: 1, label: '>1 clamps to opaque' },
		{ cursor_opacity: -1, expected: 0, label: 'negative clamps to 0' },
	])('resolves cursor-opacity ($label)', ({ cursor_opacity, expected }) => {
		expect(resolveCursor({ ...EMPTY_CONFIG, cursor_opacity }).opacity).toBe(
			expected,
		)
	})
})
