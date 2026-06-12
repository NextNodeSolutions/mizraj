import { describe, expect, it, vi } from 'vitest'

import type { ResolvedFont } from './ghosttyConfig'
import { EMPTY_CONFIG } from './ghosttyConfig'
import type { RenderBundle } from './ghosttyConfigCache'
import { buildFontTable } from './terminalAttrs'
import { measureCell } from './terminalRenderer'
import { applyFontSizeDelta } from './useTerminalCanvas'

// jsdom has no 2d canvas backend, so we fake the two surfaces measureCell
// touches (`font` setter + `measureText`), same double as terminalRenderer's
// tests: measureText keys its width off the font it was just given, proving
// metrics are re-derived from the delta-shifted size.
const fakeContextMeasuringEm = (
	advancePerPx: number,
): CanvasRenderingContext2D => {
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
	// measureCell reads only the `font` setter and `measureText` faked here.
	return context
}

const variant = {
	familyCss: 'monospace',
	weight: 'normal',
	style: 'normal',
} as const

const font: ResolvedFont = {
	regular: variant,
	bold: variant,
	italic: variant,
	boldItalic: variant,
	sizePx: 14,
	lineHeightRatio: 1.2,
	cellWidthAdjustment: null,
}

const bundleAt = (context: CanvasRenderingContext2D): RenderBundle => ({
	config: EMPTY_CONFIG,
	font,
	metrics: measureCell(context, font),
	fontTable: buildFontTable(font),
	palette: [],
})

describe('applyFontSizeDelta', () => {
	it('returns the cached bundle object untouched at delta 0', () => {
		const context = fakeContextMeasuringEm(0.6)
		const bundle = bundleAt(context)
		expect(applyFontSizeDelta(bundle, 0, context)).toBe(bundle)
	})

	it('re-derives font, metrics and font table from the shifted size', () => {
		const context = fakeContextMeasuringEm(0.6)
		const bundle = bundleAt(context)
		const sized = applyFontSizeDelta(bundle, 2, context)
		expect(sized.font.sizePx).toBe(16)
		expect(sized.metrics.cellWidth).toBeCloseTo(16 * 0.6, 5)
		expect(sized.metrics.lineHeight).toBeCloseTo(16 * 1.2, 5)
		expect(sized.fontTable).not.toBe(bundle.fontTable)
		expect(sized.fontTable[0]).toContain('16px')
		// The pristine bundle is never mutated — reset_font_size lands back on it.
		expect(bundle.font.sizePx).toBe(14)
	})

	it('clamps a large negative delta at the minimum font size', () => {
		const context = fakeContextMeasuringEm(0.6)
		const bundle = bundleAt(context)
		const sized = applyFontSizeDelta(bundle, -100, context)
		expect(sized.font.sizePx).toBe(4)
	})
})
