import { describe, expect, it } from 'vitest'

import { EMPTY_CONFIG } from './ghosttyConfig'
import type { GhosttyConfig, PaletteEntry } from './ghosttyConfig'
import { ghosttyThemeTokens, THEME_TOKEN_KEYS } from './ghosttyTheme'

// A Catppuccin-Latte-shaped config: light background, dark foreground, and a
// full 16-entry palette (indices 0..15). Built from EMPTY_CONFIG so only the
// theme-relevant fields are set and the rest stay at their "use default" nulls.
const LATTE_BG = '#eff1f5'
const LATTE_FG = '#4c4f69'

const paletteOf = (...colors: string[]): PaletteEntry[] =>
	colors.map((color, index) => ({ index, color }))

const latteConfig = (palette: PaletteEntry[]): GhosttyConfig => ({
	...EMPTY_CONFIG,
	background: LATTE_BG,
	foreground: LATTE_FG,
	palette,
})

// The Catppuccin-Latte ANSI 0..15 set: distinct per index so a token can assert
// exactly which palette slot it pulled from (the bright hues 9/12/13/14 feed the
// maroon/lavender/mauve/sky accents).
const FULL_PALETTE = paletteOf(
	'#5c5f77', // 0 black
	'#d20f39', // 1 red
	'#40a02b', // 2 green
	'#df8e1d', // 3 yellow
	'#1e66f5', // 4 blue
	'#ea76cb', // 5 magenta
	'#179299', // 6 cyan
	'#acb0be', // 7 white
	'#6c6f85', // 8 bright black
	'#de293e', // 9 bright red
	'#49af3d', // 10 bright green
	'#eea02d', // 11 bright yellow
	'#456eff', // 12 bright blue
	'#fe85fb', // 13 bright magenta
	'#27aeeb', // 14 bright cyan
	'#bcc0cc', // 15 bright white
)

describe('ghosttyThemeTokens', () => {
	it('returns null when the config carries no background (no theme to apply)', () => {
		expect(ghosttyThemeTokens(EMPTY_CONFIG)).toBeNull()
	})

	it('returns null even when a foreground is present but the background is not', () => {
		const foregroundOnly: GhosttyConfig = {
			...EMPTY_CONFIG,
			foreground: LATTE_FG,
		}

		expect(ghosttyThemeTokens(foregroundOnly)).toBeNull()
	})

	it('maps background and foreground straight onto the base color tokens', () => {
		const tokens = ghosttyThemeTokens(latteConfig([]))

		expect(tokens).not.toBeNull()
		expect(tokens?.['--gx-background']).toBe(LATTE_BG)
		expect(tokens?.['--gx-foreground']).toBe(LATTE_FG)
		expect(tokens?.['--color-bg']).toBe(LATTE_BG)
		expect(tokens?.['--color-text']).toBe(LATTE_FG)
	})

	it('drives the terminal container colors from the theme so the dark frame is gone', () => {
		const tokens = ghosttyThemeTokens(latteConfig([]))

		expect(tokens?.['--terminal-bg']).toBe(LATTE_BG)
		expect(tokens?.['--terminal-fg']).toBe(LATTE_FG)
	})

	describe('foreground fallback', () => {
		it('derives a dark contrast foreground for a light background', () => {
			const lightOnly: GhosttyConfig = {
				...EMPTY_CONFIG,
				background: LATTE_BG,
			}

			const tokens = ghosttyThemeTokens(lightOnly)

			// Latte bg is light, so the foreground falls back to near-black.
			expect(tokens?.['--gx-foreground']).toBe('#11111b')
			expect(tokens?.['--color-text']).toBe('#11111b')
		})

		it('derives a light contrast foreground for a dark background', () => {
			const darkOnly: GhosttyConfig = {
				...EMPTY_CONFIG,
				background: '#1e1e2e',
			}

			const tokens = ghosttyThemeTokens(darkOnly)

			// Mocha bg is dark, so the foreground falls back to near-white.
			expect(tokens?.['--gx-foreground']).toBe('#cdd6f4')
			expect(tokens?.['--color-text']).toBe('#cdd6f4')
		})

		it('expands a short #rgb background before judging its luminance', () => {
			const shortHex: GhosttyConfig = {
				...EMPTY_CONFIG,
				background: '#fff',
			}

			const tokens = ghosttyThemeTokens(shortHex)

			// #fff expands to #ffffff, a light background -> near-black foreground.
			expect(tokens?.['--gx-foreground']).toBe('#11111b')
		})

		it('treats an unparseable (non-hex) background as dark for legibility', () => {
			const namedColor: GhosttyConfig = {
				...EMPTY_CONFIG,
				background: 'rgb(20, 20, 20)',
			}

			const tokens = ghosttyThemeTokens(namedColor)

			// Cannot cheaply parse rgb() here, so fall back to the dark default,
			// which pairs with the near-white foreground.
			expect(tokens?.['--gx-foreground']).toBe('#cdd6f4')
			// The raw background is still passed straight through untouched.
			expect(tokens?.['--gx-background']).toBe('rgb(20, 20, 20)')
		})
	})

	describe('grey ramp', () => {
		it('anchors base on the background and text on the foreground', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--ctp-base']).toBe(LATTE_BG)
			expect(tokens?.['--ctp-text']).toBe(LATTE_FG)
		})

		it('derives the inner ramp as color-mix steps off the bg/fg pair', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--ctp-mantle']).toBe(
				'color-mix(in srgb, var(--gx-background) 96%, var(--gx-foreground))',
			)
			expect(tokens?.['--ctp-crust']).toBe(
				'color-mix(in srgb, var(--gx-background) 92%, var(--gx-foreground))',
			)
			expect(tokens?.['--ctp-surface1']).toBe(
				'color-mix(in srgb, var(--gx-background) 82%, var(--gx-foreground))',
			)
			expect(tokens?.['--ctp-overlay1']).toBe(
				'color-mix(in srgb, var(--gx-background) 54%, var(--gx-foreground))',
			)
			expect(tokens?.['--ctp-subtext1']).toBe(
				'color-mix(in srgb, var(--gx-background) 20%, var(--gx-foreground))',
			)
		})
	})

	describe('accents', () => {
		it('paints each Catppuccin accent from its mapped palette slot', () => {
			const tokens = ghosttyThemeTokens(latteConfig(FULL_PALETTE))

			expect(tokens?.['--ctp-red']).toBe('#d20f39')
			expect(tokens?.['--ctp-green']).toBe('#40a02b')
			expect(tokens?.['--ctp-yellow']).toBe('#df8e1d')
			expect(tokens?.['--ctp-blue']).toBe('#1e66f5')
			expect(tokens?.['--ctp-pink']).toBe('#ea76cb')
			expect(tokens?.['--ctp-teal']).toBe('#179299')
		})

		it('pulls the bright-hue accents from indices 9/12/13/14', () => {
			const tokens = ghosttyThemeTokens(latteConfig(FULL_PALETTE))

			expect(tokens?.['--ctp-maroon']).toBe('#de293e') // 9 bright red
			expect(tokens?.['--ctp-lavender']).toBe('#456eff') // 12 bright blue
			expect(tokens?.['--ctp-mauve']).toBe('#fe85fb') // 13 bright magenta
			expect(tokens?.['--ctp-sky']).toBe('#27aeeb') // 14 bright cyan
		})

		it('maps the semantic accent/link tokens from the blue, cyan and magenta slots', () => {
			const tokens = ghosttyThemeTokens(latteConfig(FULL_PALETTE))

			expect(tokens?.['--color-accent']).toBe('#1e66f5') // 4 blue
			expect(tokens?.['--color-accent-hover']).toBe('#179299') // 6 cyan
			expect(tokens?.['--color-link']).toBe('#1e66f5') // 4 blue
			expect(tokens?.['--color-link-hover']).toBe('#fe85fb') // 13 bright magenta
		})

		it('maps the danger token from the red slot', () => {
			const tokens = ghosttyThemeTokens(latteConfig(FULL_PALETTE))

			expect(tokens?.['--color-danger']).toBe('#d20f39') // 1 red
		})

		it('still defines every accent from xterm defaults when the palette is sparse', () => {
			// Only index 4 (blue) overridden: blue is the override, but every other
			// accent still resolves against the renderer's xterm defaults via
			// buildPalette, so NO accent leaks back to a Catppuccin value.
			const tokens = ghosttyThemeTokens(
				latteConfig([{ index: 4, color: '#1e66f5' }]),
			)

			expect(tokens?.['--color-accent']).toBe('#1e66f5')
			expect(tokens?.['--ctp-blue']).toBe('#1e66f5')
			// xterm ANSI defaults (terminalRenderer ANSI_16): red=#cd0000,
			// green=#00cd00, cyan=#00cdcd, bright magenta(13)=#ff00ff.
			expect(tokens?.['--ctp-red']).toBe('#cd0000')
			expect(tokens?.['--ctp-green']).toBe('#00cd00')
			expect(tokens?.['--ctp-teal']).toBe('#00cdcd')
			expect(tokens?.['--color-link-hover']).toBe('#ff00ff')
		})
	})

	describe('semantic surfaces and overlays', () => {
		it('derives surfaces and borders as color-mix steps off the bg/fg pair', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--color-bg-elevated']).toBe(
				'color-mix(in srgb, var(--gx-background) 95%, var(--gx-foreground))',
			)
			expect(tokens?.['--color-surface']).toBe(
				'color-mix(in srgb, var(--gx-background) 90%, var(--gx-foreground))',
			)
			expect(tokens?.['--color-border']).toBe(
				'color-mix(in srgb, var(--gx-background) 82%, var(--gx-foreground))',
			)
			expect(tokens?.['--color-border-subtle']).toBe(
				'color-mix(in srgb, var(--gx-background) 88%, var(--gx-foreground))',
			)
		})

		it('mirrors muted text onto the subtext0 ramp step', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--color-text-muted']).toBe(
				tokens?.['--ctp-subtext0'],
			)
			expect(tokens?.['--color-text-muted']).toBe(
				'color-mix(in srgb, var(--gx-background) 34%, var(--gx-foreground))',
			)
		})

		it('derives hover, active and backdrop overlays as transparent mixes toward the foreground', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--color-hover-overlay']).toBe(
				'color-mix(in srgb, transparent 92%, var(--gx-foreground))',
			)
			expect(tokens?.['--color-active-overlay']).toBe(
				'color-mix(in srgb, transparent 86%, var(--gx-foreground))',
			)
			expect(tokens?.['--color-backdrop']).toBe(
				'color-mix(in srgb, transparent 55%, var(--gx-foreground))',
			)
		})
	})

	describe('shadows', () => {
		it('anchors both shadows on the theme crust rather than a Catppuccin color', () => {
			const tokens = ghosttyThemeTokens(latteConfig([]))

			expect(tokens?.['--shadow-elevated']).toBe(
				'0 20px 60px color-mix(in srgb, transparent 72%, var(--ctp-crust))',
			)
			expect(tokens?.['--shadow-input']).toBe(
				'0 2px 2px color-mix(in srgb, transparent 82%, var(--ctp-crust))',
			)
		})
	})

	it('emits exactly the keys declared in THEME_TOKEN_KEYS so cleanup cannot drift', () => {
		const tokens = ghosttyThemeTokens(latteConfig(FULL_PALETTE))

		expect(tokens).not.toBeNull()
		expect(new Set(Object.keys(tokens ?? {}))).toEqual(
			new Set(THEME_TOKEN_KEYS),
		)
		expect(Object.keys(tokens ?? {})).toHaveLength(THEME_TOKEN_KEYS.length)
	})

	it('has no duplicate property names in THEME_TOKEN_KEYS', () => {
		expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKEN_KEYS.length)
	})
})
