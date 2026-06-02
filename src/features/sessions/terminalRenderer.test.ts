import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_FONT_STACK, EMPTY_CONFIG, resolveFont } from './ghosttyConfig'
import { cellRect, gridForSize, measureCell } from './terminalRenderer'

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
