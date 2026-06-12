import { describe, expect, it } from 'vitest'

import {
	EMPTY_CONFIG,
	GLYPH_FALLBACK_STACK,
	resolveFont,
} from './ghosttyConfig'
import { buildFontTable, decodeAttrs, fontFor } from './terminalAttrs'

// Raw attrs bytes for the variant axes (mirrors the backend bitfield):
// BOLD = 1 << 0, ITALIC = 1 << 1.
const ATTRS_PLAIN = 0
const ATTRS_BOLD = 1
const ATTRS_ITALIC = 2
const ATTRS_BOLD_ITALIC = 3

describe('fontFor', () => {
	it('draws a bold cell with the configured bold family at normal weight', () => {
		const font = resolveFont({
			...EMPTY_CONFIG,
			font_family: ['Reg'],
			font_family_bold: ['Reg Bold'],
		})

		expect(fontFor(decodeAttrs(ATTRS_BOLD), font)).toBe(
			`normal normal ${font.sizePx}px Reg Bold, ${GLYPH_FALLBACK_STACK}`,
		)
	})

	it('synthesizes CSS bold weight when no bold family is configured', () => {
		const font = resolveFont({ ...EMPTY_CONFIG, font_family: ['Reg'] })

		expect(fontFor(decodeAttrs(ATTRS_BOLD), font)).toBe(
			`normal bold ${font.sizePx}px Reg, ${GLYPH_FALLBACK_STACK}`,
		)
	})

	it('synthesizes CSS italic style when no italic family is configured', () => {
		const font = resolveFont({ ...EMPTY_CONFIG, font_family: ['Reg'] })

		expect(fontFor(decodeAttrs(ATTRS_ITALIC), font)).toBe(
			`italic normal ${font.sizePx}px Reg, ${GLYPH_FALLBACK_STACK}`,
		)
	})

	it('draws a plain cell with the regular family at normal weight and style', () => {
		const font = resolveFont({ ...EMPTY_CONFIG, font_family: ['Reg'] })

		expect(fontFor(decodeAttrs(ATTRS_PLAIN), font)).toBe(
			`normal normal ${font.sizePx}px Reg, ${GLYPH_FALLBACK_STACK}`,
		)
	})
})

describe('buildFontTable', () => {
	it('precomputes 256 font strings indexed by the raw attrs byte', () => {
		const font = resolveFont(EMPTY_CONFIG)

		expect(buildFontTable(font)).toHaveLength(256)
	})

	it('matches fontFor for the bold-italic byte', () => {
		const font = resolveFont(EMPTY_CONFIG)
		const table = buildFontTable(font)

		expect(table[ATTRS_BOLD_ITALIC]).toBe(
			fontFor(decodeAttrs(ATTRS_BOLD_ITALIC), font),
		)
	})
})
