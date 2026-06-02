import { describe, expect, it, vi } from 'vitest'

import {
	DEFAULT_FONT_STACK,
	EMPTY_CONFIG,
	resolveBackgroundAlpha,
	resolveFont,
} from './ghosttyConfig'
import { buildFontTable } from './terminalAttrs'
import { buildPalette } from './terminalPalette'
import type { TerminalConfig } from './terminalRenderer'
import {
	cellRect,
	drawFrame,
	gridForSize,
	measureCell,
} from './terminalRenderer'
import type { CellFramePayload, WireCell } from './terminalWire'

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
	it('falls back to the built-in 13px/1.2 mono stack when the config is empty', () => {
		expect(resolveFont(EMPTY_CONFIG)).toEqual({
			familyCss: DEFAULT_FONT_STACK,
			sizePx: 13,
			lineHeightRatio: 1.2,
		})
	})

	it('prepends configured families to the default stack as a fallback chain', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['MonoLisa', 'JetBrains Mono'],
		})

		expect(font.familyCss).toBe(
			`MonoLisa, JetBrains Mono, ${DEFAULT_FONT_STACK}`,
		)
	})

	it('uses the configured font size', () => {
		expect(resolveFont({ ...EMPTY_CONFIG, font_size: 16 }).sizePx).toBe(16)
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

describe('measureCell', () => {
	it('sets a plain (normal/normal) font string from the resolved font', () => {
		const { context, setFont } = fakeContextMeasuringEm(0.6)

		measureCell(context, {
			familyCss: 'JetBrains Mono',
			sizePx: 16,
			lineHeightRatio: 1.5,
		})

		expect(setFont).toHaveBeenCalledWith(
			'normal normal 16px JetBrains Mono',
		)
	})

	it('derives lineHeight as sizePx * lineHeightRatio of the passed font', () => {
		const { context } = fakeContextMeasuringEm(0.6)

		const metrics = measureCell(context, {
			familyCss: 'JetBrains Mono',
			sizePx: 20,
			lineHeightRatio: 1.4,
		})

		expect(metrics.lineHeight).toBeCloseTo(28, 5)
	})

	it('measures cellWidth at the passed font size, not a fixed default', () => {
		const { context } = fakeContextMeasuringEm(0.6)

		const big = measureCell(context, {
			familyCss: 'JetBrains Mono',
			sizePx: 26,
			lineHeightRatio: 1.2,
		})

		// 26px * 0.6 advance = 15.6: proof the width tracks the given size.
		expect(big.cellWidth).toBeCloseTo(15.6, 5)
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
type Paint = { op: 'rect' | 'text'; fillStyle: string; alpha: number }

const recordingContext = (): {
	context: CanvasRenderingContext2D
	paints: Paint[]
} => {
	const paints: Paint[] = []
	const state = { fillStyle: '', globalAlpha: 1 }
	const context = {
		canvas: { width: 800, height: 600 },
		set fillStyle(value: string) {
			state.fillStyle = value
		},
		set globalAlpha(value: number) {
			state.globalAlpha = value
		},
		set font(_value: string) {},
		set textBaseline(_value: string) {},
		save() {},
		restore() {},
		setTransform() {},
		fillRect() {
			paints.push({
				op: 'rect',
				fillStyle: state.fillStyle,
				alpha: state.globalAlpha,
			})
		},
		fillText() {
			paints.push({
				op: 'text',
				fillStyle: state.fillStyle,
				alpha: state.globalAlpha,
			})
		},
	}
	// @ts-expect-error - deliberate partial CanvasRenderingContext2D double;
	// jsdom cannot provide a real 2d context, and drawFrame touches only the
	// members faked here (fillStyle/globalAlpha setters, save/restore/
	// setTransform, fillRect/fillText, canvas dimensions).
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
}

const oneCellFrame = (cell: WireCell): CellFramePayload => ({
	session_id: 'sess-1',
	cols: 1,
	rows: 1,
	cells: [cell],
})

const configWith = (overrides: Partial<TerminalConfig>): TerminalConfig => ({
	colors: { background: LATTE_BG, foreground: LATTE_FG },
	font: resolveFont(EMPTY_CONFIG),
	palette: buildPalette([]),
	backgroundAlpha: 1,
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

	it('resolves an indexed fg against the config palette override, not the xterm default', () => {
		const { context, paints } = recordingContext()
		const fontTable = buildFontTable(resolveFont(EMPTY_CONFIG))
		// ANSI index 15 (default xterm white #ffffff) overridden by Latte's #dce0e8.
		const indexedCell: WireCell = {
			ch: 'A',
			fg: { kind: 'indexed', idx: 15 },
			bg: { kind: 'default' },
			attrs: 0,
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
