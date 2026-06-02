import { useEffect } from 'react'

import { useAppearance } from '@/features/settings/settings'

import type { GhosttyConfig } from './ghosttyConfig'
import { loadGhosttyConfig } from './ghosttyConfig'
import { buildPalette } from './terminalRenderer'

// Drives the WHOLE app chrome from the user's resolved Ghostty theme, not just
// the terminal canvas: when a theme is present we override App.css's Catppuccin
// tokens with inline custom properties on <html>, so the surrounding chrome
// (top bar, sidebar, panels) and the terminal share one palette. When no theme
// is present we touch nothing, and a no-config user stays on stock Catppuccin.
//
// The emitted set is COMPLETE: every app token that would otherwise resolve to a
// Catppuccin value (the full grey ramp, all accents, semantics, overlays,
// shadows) is overridden, so a non-Catppuccin theme produces zero Catppuccin
// leakage. Accents come from the Ghostty palette resolved against the renderer's
// xterm defaults, the grey ramp is mixed from bg -> fg, and shadows anchor on the
// theme's darkest grey. Nothing falls back to the stylesheet while a theme runs.

// Which ANSI palette index feeds each app/Catppuccin accent. The normal hues
// (1..6) and the bright hues (9, 12, 13, 14) are picked by approximate color
// family so a 16-color terminal palette still paints the richer Catppuccin
// accent set entirely from the theme, never from a Catppuccin value.
const PALETTE_RED = 1
const PALETTE_GREEN = 2
const PALETTE_YELLOW = 3
const PALETTE_BLUE = 4
const PALETTE_MAGENTA = 5
const PALETTE_CYAN = 6
const PALETTE_BRIGHT_RED = 9
const PALETTE_BRIGHT_BLUE = 12
const PALETTE_BRIGHT_MAGENTA = 13
const PALETTE_BRIGHT_CYAN = 14

// Near-black / near-white legibility anchors for the foreground fallback. Real
// themes always declare a foreground; this only fires for a background-only
// config so text never lands unreadable on its own background.
const CONTRAST_DARK = '#11111b'
const CONTRAST_LIGHT = '#cdd6f4'

// sRGB relative-luminance threshold (0..1) splitting "light" from "dark"
// backgrounds. 0.5 is the standard midpoint; above it the background is light
// and wants dark text, below it it is dark and wants light text.
const LUMINANCE_MIDPOINT = 0.5
const MAX_CHANNEL = 255
const HEX_SHORT_LENGTH = 3
const HEX_LONG_LENGTH = 6
const LUMINANCE_RED_WEIGHT = 0.299
const LUMINANCE_GREEN_WEIGHT = 0.587
const LUMINANCE_BLUE_WEIGHT = 0.114

const HEX_CHANNEL_RADIX = 16
const HEX_PAIR_LENGTH = 2

// Each `#rrggbb` byte pair, paired with its Rec. 601 luminance weight, so the
// channel offsets are derived (pair index x 2) rather than hard-coded slice
// literals. Listed darkest-perceived to brightest only for readability.
const HEX_CHANNELS = [
	{ weight: LUMINANCE_RED_WEIGHT },
	{ weight: LUMINANCE_GREEN_WEIGHT },
	{ weight: LUMINANCE_BLUE_WEIGHT },
] as const

// Expand a short `#rgb` body into its `#rrggbb` equivalent. Returns the original
// body unchanged when it is not the short form, so the caller can length-check
// once against the long form.
const expandShortHex = (body: string): string => {
	if (body.length !== HEX_SHORT_LENGTH) return body
	return [...body].map(channel => `${channel}${channel}`).join('')
}

// The summed, weighted luminance (0..1) of a `#rgb`/`#rrggbb` background, or null
// when the string is not a hex literal (e.g. an `rgb(...)` or named color we
// cannot cheaply parse here). Pure: string in, number-or-null out.
const hexLuminance = (color: string): number | null => {
	if (!color.startsWith('#')) return null
	const body = expandShortHex(color.slice(1))
	if (body.length !== HEX_LONG_LENGTH) return null

	let weightedSum = 0
	for (const [pairIndex, { weight }] of HEX_CHANNELS.entries()) {
		const start = pairIndex * HEX_PAIR_LENGTH
		const channel = Number.parseInt(
			body.slice(start, start + HEX_PAIR_LENGTH),
			HEX_CHANNEL_RADIX,
		)
		if (Number.isNaN(channel)) return null
		weightedSum += weight * channel
	}
	return weightedSum / MAX_CHANNEL
}

// A near-black or near-white that stays legible on `background`. Uses the
// perceptual (Rec. 601) luminance of the background: a light background gets
// dark text, a dark one gets light text. An unparseable background is treated
// as dark, the safe default for a terminal. Pure: color string in, color out.
const contrastColor = (background: string): string => {
	const luminance = hexLuminance(background)
	if (luminance === null) return CONTRAST_LIGHT
	return luminance > LUMINANCE_MIDPOINT ? CONTRAST_DARK : CONTRAST_LIGHT
}

// Surfaces, borders and the grey ramp are derived from the bg/fg pair with
// color-mix so the same recipe reads correctly in BOTH light and dark themes:
// mixing the background TOWARD the foreground always yields a legible step (a
// slightly "inked" surface on light, a slightly "lifted" surface on dark). The
// `backgroundWeight` is the literal percentage of background kept in the mix:
// 100 is pure bg, 0 is pure fg, so a lower weight = more foreground ink.
const mixBackgroundToForeground = (backgroundWeight: number): string =>
	`color-mix(in srgb, var(--gx-background) ${backgroundWeight}%, var(--gx-foreground))`

// Overlays mix transparent toward the foreground so hover/active stay faint
// foreground washes that work on any background. `transparentWeight` is the
// percentage of transparency kept; higher = fainter wash.
const overlayFromForeground = (transparentWeight: number): string =>
	`color-mix(in srgb, transparent ${transparentWeight}%, var(--gx-foreground))`

// Shadows anchor on the theme's darkest grey (`--ctp-crust`, emitted below) so
// depth reads without injecting a Catppuccin color. `transparentWeight` is the
// percentage of transparency kept.
const shadowFromCrust = (offset: string, transparentWeight: number): string =>
	`${offset} color-mix(in srgb, transparent ${transparentWeight}%, var(--ctp-crust))`

// Grey-ramp background weights, darkest (most-bg) step first. Each is the
// percentage of background kept while mixing toward the foreground; the ladder
// narrows from near-bg surfaces (96) down to foreground-heavy subtexts (20) so
// panels stay distinct from the background while text stays readable.
const RAMP_MANTLE = 96
const RAMP_CRUST = 92
const RAMP_SURFACE0 = 88
const RAMP_SURFACE1 = 82
const RAMP_SURFACE2 = 76
const RAMP_OVERLAY0 = 64
const RAMP_OVERLAY1 = 54
const RAMP_OVERLAY2 = 44
const RAMP_SUBTEXT0 = 34
const RAMP_SUBTEXT1 = 20

// Semantic-token background weights off the bg/fg pair.
const ELEVATED_BG_WEIGHT = 95
const SURFACE_BG_WEIGHT = 90
const BORDER_BG_WEIGHT = 82
const BORDER_SUBTLE_BG_WEIGHT = 88
const MUTED_TEXT_BG_WEIGHT = RAMP_SUBTEXT0

const HOVER_TRANSPARENT_WEIGHT = 92
const ACTIVE_TRANSPARENT_WEIGHT = 86
const BACKDROP_TRANSPARENT_WEIGHT = 55

const ELEVATED_SHADOW_OFFSET = '0 20px 60px'
const ELEVATED_SHADOW_TRANSPARENT_WEIGHT = 72
const INPUT_SHADOW_OFFSET = '0 2px 2px'
const INPUT_SHADOW_TRANSPARENT_WEIGHT = 82

// The exact, fixed set of properties this theme writes. It is the single source
// of truth for cleanup: the effect removes every key here before (re)applying,
// so a theme swap or unmount can never leave a stale token behind, and the set
// can never drift from what `ghosttyThemeTokens` emits (asserted in the test).
export const THEME_TOKEN_KEYS = [
	'--gx-background',
	'--gx-foreground',
	'--terminal-bg',
	'--terminal-fg',
	'--ctp-base',
	'--ctp-mantle',
	'--ctp-crust',
	'--ctp-surface0',
	'--ctp-surface1',
	'--ctp-surface2',
	'--ctp-overlay0',
	'--ctp-overlay1',
	'--ctp-overlay2',
	'--ctp-subtext0',
	'--ctp-subtext1',
	'--ctp-text',
	'--ctp-red',
	'--ctp-maroon',
	'--ctp-rosewater',
	'--ctp-flamingo',
	'--ctp-pink',
	'--ctp-mauve',
	'--ctp-lavender',
	'--ctp-peach',
	'--ctp-yellow',
	'--ctp-green',
	'--ctp-teal',
	'--ctp-sky',
	'--ctp-sapphire',
	'--ctp-blue',
	'--color-bg',
	'--color-bg-elevated',
	'--color-surface',
	'--color-text',
	'--color-text-muted',
	'--color-border',
	'--color-border-subtle',
	'--color-accent',
	'--color-accent-hover',
	'--color-link',
	'--color-link-hover',
	'--color-hover-overlay',
	'--color-active-overlay',
	'--color-backdrop',
	'--color-danger',
	'--shadow-elevated',
	'--shadow-input',
] as const

// The CSS variable -> value map for a themed config. `--gx-background` and
// `--gx-foreground` anchor the color-mix recipes; every other token derives from
// them or from the resolved Ghostty palette, so NOTHING falls back to the
// stylesheet's Catppuccin tokens while a theme is active. Accents resolve against
// the renderer's xterm defaults (via buildPalette), so a sparse `palette` that
// overrides only a few indices still yields a full, theme-coherent accent set.
// Returns null when the config carries no background, i.e. there is no theme to
// apply and the caller must leave Catppuccin untouched. Pure: no DOM, no IO.
export const ghosttyThemeTokens = (
	config: GhosttyConfig,
): Record<string, string> | null => {
	const background = config.background
	if (background === null) return null

	const foreground = config.foreground ?? contrastColor(background)
	const palette = buildPalette(config.palette)
	const colorAt = (index: number): string => palette[index] ?? foreground

	return {
		'--gx-background': background,
		'--gx-foreground': foreground,
		'--terminal-bg': background,
		'--terminal-fg': foreground,

		'--ctp-base': background,
		'--ctp-mantle': mixBackgroundToForeground(RAMP_MANTLE),
		'--ctp-crust': mixBackgroundToForeground(RAMP_CRUST),
		'--ctp-surface0': mixBackgroundToForeground(RAMP_SURFACE0),
		'--ctp-surface1': mixBackgroundToForeground(RAMP_SURFACE1),
		'--ctp-surface2': mixBackgroundToForeground(RAMP_SURFACE2),
		'--ctp-overlay0': mixBackgroundToForeground(RAMP_OVERLAY0),
		'--ctp-overlay1': mixBackgroundToForeground(RAMP_OVERLAY1),
		'--ctp-overlay2': mixBackgroundToForeground(RAMP_OVERLAY2),
		'--ctp-subtext0': mixBackgroundToForeground(RAMP_SUBTEXT0),
		'--ctp-subtext1': mixBackgroundToForeground(RAMP_SUBTEXT1),
		'--ctp-text': foreground,

		'--ctp-red': colorAt(PALETTE_RED),
		'--ctp-maroon': colorAt(PALETTE_BRIGHT_RED),
		'--ctp-rosewater': colorAt(PALETTE_BRIGHT_RED),
		'--ctp-flamingo': colorAt(PALETTE_BRIGHT_RED),
		'--ctp-pink': colorAt(PALETTE_MAGENTA),
		'--ctp-mauve': colorAt(PALETTE_BRIGHT_MAGENTA),
		'--ctp-lavender': colorAt(PALETTE_BRIGHT_BLUE),
		'--ctp-peach': colorAt(PALETTE_YELLOW),
		'--ctp-yellow': colorAt(PALETTE_YELLOW),
		'--ctp-green': colorAt(PALETTE_GREEN),
		'--ctp-teal': colorAt(PALETTE_CYAN),
		'--ctp-sky': colorAt(PALETTE_BRIGHT_CYAN),
		'--ctp-sapphire': colorAt(PALETTE_CYAN),
		'--ctp-blue': colorAt(PALETTE_BLUE),

		'--color-bg': background,
		'--color-bg-elevated': mixBackgroundToForeground(ELEVATED_BG_WEIGHT),
		'--color-surface': mixBackgroundToForeground(SURFACE_BG_WEIGHT),
		'--color-text': foreground,
		'--color-text-muted': mixBackgroundToForeground(MUTED_TEXT_BG_WEIGHT),
		'--color-border': mixBackgroundToForeground(BORDER_BG_WEIGHT),
		'--color-border-subtle': mixBackgroundToForeground(
			BORDER_SUBTLE_BG_WEIGHT,
		),
		'--color-accent': colorAt(PALETTE_BLUE),
		'--color-accent-hover': colorAt(PALETTE_CYAN),
		'--color-link': colorAt(PALETTE_BLUE),
		'--color-link-hover': colorAt(PALETTE_BRIGHT_MAGENTA),
		'--color-hover-overlay': overlayFromForeground(
			HOVER_TRANSPARENT_WEIGHT,
		),
		'--color-active-overlay': overlayFromForeground(
			ACTIVE_TRANSPARENT_WEIGHT,
		),
		'--color-backdrop': overlayFromForeground(BACKDROP_TRANSPARENT_WEIGHT),
		'--color-danger': colorAt(PALETTE_RED),

		'--shadow-elevated': shadowFromCrust(
			ELEVATED_SHADOW_OFFSET,
			ELEVATED_SHADOW_TRANSPARENT_WEIGHT,
		),
		'--shadow-input': shadowFromCrust(
			INPUT_SHADOW_OFFSET,
			INPUT_SHADOW_TRANSPARENT_WEIGHT,
		),
	}
}

// Synchronizes <html>'s inline theme variables with the resolved Ghostty theme.
// This is a legitimate external-system sync (the document is outside React's
// tree): the effect fetches the config for the current appearance, clears any
// previously written theme tokens, then writes the fresh set when a theme is
// present. The async fetch is guarded so a late resolution never paints a
// torn-down (appearance-changed) scope. Mount once near the top of App.
export const useGhosttyTheme = (): void => {
	const appearance = useAppearance()

	useEffect(() => {
		let cancelled = false
		const { style } = document.documentElement

		const clearThemeTokens = (): void => {
			for (const name of THEME_TOKEN_KEYS) style.removeProperty(name)
		}

		void loadGhosttyConfig(appearance).then(config => {
			if (cancelled) return
			clearThemeTokens()
			const tokens = ghosttyThemeTokens(config)
			if (!tokens) return
			for (const [name, value] of Object.entries(tokens)) {
				style.setProperty(name, value)
			}
		})

		return () => {
			cancelled = true
			clearThemeTokens()
		}
	}, [appearance])
}
