import { describe, expect, it } from 'vitest'

import { brightenForBold, buildPalette } from './terminalPalette'
import type { WireColor } from './terminalWire'

// Catppuccin Latte fragments used as realistic, hardcoded expected values: a
// light theme overrides the default ANSI 0/15 (black/white) with its own beige
// and ink, so an `indexed` cell color must resolve to the OVERRIDE, not the
// xterm default.
const LATTE_ANSI_0 = '#5c5f77'
const XTERM_DEFAULT_RED = '#cd0000'
const XTERM_DEFAULT_CUBE_21 = 'rgb(0, 0, 255)'

describe('buildPalette', () => {
	it('keeps the full xterm default table when there are no overrides', () => {
		const palette = buildPalette([])

		expect(palette).toHaveLength(256)
		expect(palette[1]).toBe(XTERM_DEFAULT_RED)
		// index 21 is the first fully-blue cube entry, untouched by a theme.
		expect(palette[21]).toBe(XTERM_DEFAULT_CUBE_21)
	})

	it('lets a config override win at its own index', () => {
		const palette = buildPalette([{ index: 0, color: LATTE_ANSI_0 }])

		expect(palette[0]).toBe(LATTE_ANSI_0)
	})

	it('leaves indices the config did not override at the xterm default', () => {
		const palette = buildPalette([{ index: 0, color: LATTE_ANSI_0 }])

		// only index 0 was overridden; 1 (red) and 21 (cube blue) are unchanged.
		expect(palette[1]).toBe(XTERM_DEFAULT_RED)
		expect(palette[21]).toBe(XTERM_DEFAULT_CUBE_21)
	})

	it('ignores out-of-range override indices without growing or holing the table', () => {
		const palette = buildPalette([
			{ index: -1, color: '#deadbe' },
			{ index: 256, color: '#feedee' },
		])

		expect(palette).toHaveLength(256)
		expect(palette[255]).toBe('rgb(238, 238, 238)')
	})

	it('does not mutate the shared xterm defaults across builds', () => {
		buildPalette([{ index: 1, color: LATTE_ANSI_0 }])
		const second = buildPalette([])

		// a prior build's override must not bleed into a later default build.
		expect(second[1]).toBe(XTERM_DEFAULT_RED)
	})
})

describe('brightenForBold', () => {
	const BOLD = true
	const ENABLED = true

	it.each([
		{ idx: 0, brightIdx: 8 },
		{ idx: 1, brightIdx: 9 },
		{ idx: 7, brightIdx: 15 },
	])(
		'promotes a bold standard ANSI fg $idx to its bright counterpart $brightIdx',
		({ idx, brightIdx }) => {
			expect(
				brightenForBold({ kind: 'indexed', idx }, BOLD, ENABLED),
			).toEqual({ kind: 'indexed', idx: brightIdx })
		},
	)

	it.each<{ label: string; color: WireColor }>([
		{ label: 'already-bright index 8', color: { kind: 'indexed', idx: 8 } },
		{ label: 'index 15', color: { kind: 'indexed', idx: 15 } },
		{ label: 'cube index 21', color: { kind: 'indexed', idx: 21 } },
		{ label: 'truecolor', color: { kind: 'rgb', r: 10, g: 20, b: 30 } },
		{ label: 'terminal default', color: { kind: 'default' } },
	])('leaves a bold $label untouched', ({ color }) => {
		expect(brightenForBold(color, BOLD, ENABLED)).toEqual(color)
	})

	it('leaves a non-bold standard ANSI fg untouched even when enabled', () => {
		expect(
			brightenForBold({ kind: 'indexed', idx: 1 }, false, ENABLED),
		).toEqual({ kind: 'indexed', idx: 1 })
	})

	it('leaves a bold standard ANSI fg untouched when the directive is off', () => {
		expect(
			brightenForBold({ kind: 'indexed', idx: 1 }, BOLD, false),
		).toEqual({ kind: 'indexed', idx: 1 })
	})
})
