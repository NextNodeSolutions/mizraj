import type { GhosttyConfig } from './ghosttyConfig'
import { contrastColor } from './ghosttyThemeColors'
import { buildPalette } from './terminalPalette'

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

// Surfaces, borders and the grey ramp are derived from the bg/fg pair with
// color-mix so the same recipe reads correctly in BOTH light and dark themes:
// mixing the background TOWARD the foreground always yields a legible step (a
// slightly "inked" surface on light, a slightly "lifted" surface on dark). The
// `backgroundWeight` is the literal percentage of background kept in the mix:
// 100 is pure bg, 0 is pure fg, so a lower weight = more foreground ink.
export const mixBackgroundToForeground = (backgroundWeight: number): string =>
	`color-mix(in srgb, var(--gx-background) ${backgroundWeight}%, var(--gx-foreground))`

// Overlays mix transparent toward the foreground so hover/active stay faint
// foreground washes that work on any background. `transparentWeight` is the
// percentage of transparency kept; higher = fainter wash.
export const overlayFromForeground = (transparentWeight: number): string =>
	`color-mix(in srgb, transparent ${transparentWeight}%, var(--gx-foreground))`

// Shadows anchor on the theme's darkest grey (`--ctp-crust`, emitted below) so
// depth reads without injecting a Catppuccin color. `transparentWeight` is the
// percentage of transparency kept.
export const shadowFromCrust = (
	offset: string,
	transparentWeight: number,
): string =>
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
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number]

export const ghosttyThemeTokens = (
	config: GhosttyConfig,
): Record<ThemeTokenKey, string> | null => {
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
