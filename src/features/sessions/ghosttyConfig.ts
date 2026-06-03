import { invoke } from '@tauri-apps/api/core'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { WireCursorStyle } from './terminalWire'

const LOAD_COMMAND = 'load_ghostty_config'

// The current renderer defaults, kept verbatim as the fallback so behavior is
// unchanged when the user has no Ghostty config (or it carries no font keys).
// The font size doubles as a points value: Ghostty's `font-size` is in points,
// but the canvas has always treated 13 as pixels, so we keep 1pt = 1px for now
// (see M2 in the parity ADR for true pt -> px scaling).
const DEFAULT_FONT_SIZE_PX = 13
const DEFAULT_LINE_HEIGHT_RATIO = 1.2
const PERCENT_TO_FRACTION = 100
export const DEFAULT_FONT_STACK =
	'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

// A cell-metric tweak from the Ghostty config: either a percentage of the
// natural metric or an absolute pixel delta. Mirrors the backend AdjustmentDto.
export type Adjustment =
	| { kind: 'percent'; value: number }
	| { kind: 'absolute'; value: number }

export type PaletteEntry = {
	index: number
	color: string
}

export type Padding = {
	start: number
	end: number
}

export type Diagnostic = {
	key: string
	value: string
	message: string
}

// The effective Ghostty config in the snake_case wire shape emitted by the
// `load_ghostty_config` Tauri command (src-tauri/src/ghostty.rs). `null`/empty
// fields mean "use the engine default" — the renderer keeps its own fallback.
// M0.5 only consumes the font fields; the rest is threaded through untouched so
// M1 (themes/palette) and M3 (cursor) can read it without re-plumbing.
export type GhosttyConfig = {
	font_family: string[]
	font_family_bold: string[]
	font_family_italic: string[]
	font_family_bold_italic: string[]
	font_size: number | null
	font_features: string[]
	adjust_cell_width: Adjustment | null
	adjust_cell_height: Adjustment | null
	adjust_underline_position: Adjustment | null
	adjust_underline_thickness: Adjustment | null
	adjust_strikethrough_position: Adjustment | null
	adjust_strikethrough_thickness: Adjustment | null
	adjust_cursor_thickness: Adjustment | null
	background: string | null
	foreground: string | null
	cursor_color: string | null
	cursor_text: string | null
	selection_background: string | null
	selection_foreground: string | null
	palette: PaletteEntry[]
	bold_is_bright: boolean | null
	background_opacity: number | null
	cursor_style: string | null
	cursor_style_blink: boolean | null
	cursor_opacity: number | null
	scrollback_limit: number | null
	window_padding_x: Padding | null
	window_padding_y: Padding | null
	window_padding_balance: boolean | null
	copy_on_select: string | null
	mouse_hide_while_typing: boolean | null
	term: string | null
	diagnostics: Diagnostic[]
}

// What the command returns when the user has no config at all. Also the value
// loadGhosttyConfig falls back to if the invoke itself fails, so the terminal
// always renders with the built-in defaults rather than crashing.
export const EMPTY_CONFIG: GhosttyConfig = {
	font_family: [],
	font_family_bold: [],
	font_family_italic: [],
	font_family_bold_italic: [],
	font_size: null,
	font_features: [],
	adjust_cell_width: null,
	adjust_cell_height: null,
	adjust_underline_position: null,
	adjust_underline_thickness: null,
	adjust_strikethrough_position: null,
	adjust_strikethrough_thickness: null,
	adjust_cursor_thickness: null,
	background: null,
	foreground: null,
	cursor_color: null,
	cursor_text: null,
	selection_background: null,
	selection_foreground: null,
	palette: [],
	bold_is_bright: null,
	background_opacity: null,
	cursor_style: null,
	cursor_style_blink: null,
	cursor_opacity: null,
	scrollback_limit: null,
	window_padding_x: null,
	window_padding_y: null,
	window_padding_balance: null,
	copy_on_select: null,
	mouse_hide_while_typing: null,
	term: null,
	diagnostics: [],
}

export type Appearance = 'light' | 'dark'

// The backend command never throws (bad config rides along in `diagnostics`),
// so the only failure here is the IPC bridge itself being unavailable. We log
// it and hand back the empty config rather than rejecting: the terminal must
// still come up with its defaults.
export const loadGhosttyConfig = async (
	appearance: Appearance,
): Promise<GhosttyConfig> => {
	try {
		return await invoke<GhosttyConfig>(LOAD_COMMAND, { appearance })
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.warn(`loadGhosttyConfig: invoke failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, appearance },
		})
		return EMPTY_CONFIG
	}
}

// One (family, synthetic weight, synthetic style) triple the canvas draws a
// given attribute combination with. A configured variant family (e.g.
// `font-family-bold`) is used verbatim at normal weight/style; when absent the
// regular family is reused and the bold/italic is synthesized by the canvas.
// The literals double as both axes: `NORMAL`/`BOLD` for weight, `NORMAL`/`ITALIC`
// for style.
const NORMAL = 'normal'
const BOLD = 'bold'
const ITALIC = 'italic'

export type FontVariant = {
	familyCss: string
	weight: typeof NORMAL | typeof BOLD
	style: typeof NORMAL | typeof ITALIC
}

// The font the canvas renderer actually draws with, resolved from the config
// with the built-in defaults as fallback. Carries one variant per (bold, italic)
// combination so an explicit `font-family-bold`/`-italic`/`-bold-italic` is
// honored, falling back to synthetic weight/style on the regular family. Pure:
// same config in, same metrics out — no IO, no canvas measurement (that is the
// renderer's measureCell job).
export type ResolvedFont = {
	regular: FontVariant
	bold: FontVariant
	italic: FontVariant
	boldItalic: FontVariant
	sizePx: number
	lineHeightRatio: number
	// adjust-cell-width, applied by measureCell to the measured natural glyph
	// width (the width is unknown until the canvas measures it, so unlike
	// lineHeightRatio it cannot be folded in here). null = no adjustment.
	cellWidthAdjustment: Adjustment | null
}

// Append the built-in monospace stack so a single missing family still has the
// same fallbacks the renderer has always had.
const familyStackFrom = (families: string[]): string => {
	if (families.length === 0) return DEFAULT_FONT_STACK
	return `${families.join(', ')}, ${DEFAULT_FONT_STACK}`
}

// A configured variant family is drawn verbatim (normal weight/style — the font
// already carries the bold/italic); when absent the regular stack is reused and
// the variant is synthesized with the given weight/style.
const variantFrom = (
	families: string[],
	regularCss: string,
	synthWeight: FontVariant['weight'],
	synthStyle: FontVariant['style'],
): FontVariant =>
	families.length === 0
		? { familyCss: regularCss, weight: synthWeight, style: synthStyle }
		: {
				familyCss: familyStackFrom(families),
				weight: NORMAL,
				style: NORMAL,
			}

// Bold-italic prefers the first configured family in priority order, drawn
// verbatim with only the axis it does NOT already carry synthesized: an explicit
// bold-italic family (synthesize nothing), the bold family (synthesize italic),
// then the italic family (synthesize bold). With none configured it falls back
// to the regular family with both axes synthesized.
const boldItalicVariant = (
	config: GhosttyConfig,
	regularCss: string,
): FontVariant => {
	const candidates: ReadonlyArray<{
		families: string[]
		weight: FontVariant['weight']
		style: FontVariant['style']
	}> = [
		{
			families: config.font_family_bold_italic,
			weight: NORMAL,
			style: NORMAL,
		},
		{ families: config.font_family_bold, weight: NORMAL, style: ITALIC },
		{ families: config.font_family_italic, weight: BOLD, style: NORMAL },
	]
	const configured = candidates.find(
		candidate => candidate.families.length > 0,
	)
	if (!configured)
		return { familyCss: regularCss, weight: BOLD, style: ITALIC }
	return {
		familyCss: familyStackFrom(configured.families),
		weight: configured.weight,
		style: configured.style,
	}
}

// Apply a cell-metric adjustment to a natural (measured or derived) pixel value:
//   - percent: scale by (1 + value/100)
//   - absolute: add `value` device pixels
// Returns the value unchanged when there is no adjustment. The shared kernel for
// both cell metrics: adjust-cell-height folds in at resolve time (via
// lineHeightRatioFrom), adjust-cell-width is applied by measureCell once the
// canvas has measured the natural glyph width.
export const applyAdjustment = (
	natural: number,
	adjustment: Adjustment | null,
): number => {
	if (!adjustment) return natural
	if (adjustment.kind === 'percent') {
		return natural * (1 + adjustment.value / PERCENT_TO_FRACTION)
	}
	return natural + adjustment.value
}

// Cell height (line box) as a ratio of the font size, honoring adjust-cell-height
// against the natural 1.2 line box: the adjustment lands on `sizePx * 1.2`, then
// the result is re-expressed back as a ratio of the configured size.
const lineHeightRatioFrom = (
	adjustment: Adjustment | null,
	sizePx: number,
): number =>
	applyAdjustment(sizePx * DEFAULT_LINE_HEIGHT_RATIO, adjustment) / sizePx

export const resolveFont = (config: GhosttyConfig): ResolvedFont => {
	const sizePx = config.font_size ?? DEFAULT_FONT_SIZE_PX
	const regularCss = familyStackFrom(config.font_family)
	return {
		regular: { familyCss: regularCss, weight: NORMAL, style: NORMAL },
		bold: variantFrom(config.font_family_bold, regularCss, BOLD, NORMAL),
		italic: variantFrom(
			config.font_family_italic,
			regularCss,
			NORMAL,
			ITALIC,
		),
		boldItalic: boldItalicVariant(config, regularCss),
		sizePx,
		lineHeightRatio: lineHeightRatioFrom(config.adjust_cell_height, sizePx),
		cellWidthAdjustment: config.adjust_cell_width,
	}
}

// background-opacity is meaningful only as a fraction strictly inside (0, 1):
// 0 would paint nothing, >=1 (or a missing value) is plain opaque. Anything
// outside that window — including a malformed negative/NaN — falls back to fully
// opaque so a bad config never makes the terminal vanish.
const OPAQUE_ALPHA = 1

export const resolveBackgroundAlpha = (config: GhosttyConfig): number => {
	const opacity = config.background_opacity
	if (opacity === null) return OPAQUE_ALPHA
	if (opacity <= 0 || opacity >= OPAQUE_ALPHA) return OPAQUE_ALPHA
	return opacity
}

// The cursor settings the renderer draws with, resolved from the config. `color`
// and `style` are null when the config leaves them unset, so the renderer falls
// back to the terminal foreground / the frame's reported style respectively.
// `textColor` is the glyph color shown under a block cursor (cursor invert).
export type ResolvedCursor = {
	color: string | null
	textColor: string | null
	style: WireCursorStyle | null
	opacity: number
}

const CURSOR_STYLES: readonly WireCursorStyle[] = [
	'block',
	'bar',
	'underline',
	'block_hollow',
]

// A cursor color is usable only as a CSS color literal (hex or `rgb(...)`).
// Ghostty's `cell-foreground`/`cell-background` sentinels are not CSS colors, so
// they fall back (null) to the renderer's default cursor color (the foreground).
const cursorColorFrom = (color: string | null): string | null => {
	if (color === null) return null
	if (color.startsWith('#') || color.startsWith('rgb')) return color
	return null
}

// cursor-style overrides the frame's reported shape only when it is a known
// style; an unknown/absent value leaves the frame's style in charge.
const cursorStyleFrom = (style: string | null): WireCursorStyle | null => {
	if (style === null) return null
	return CURSOR_STYLES.find(known => known === style) ?? null
}

// cursor-opacity clamped to [0, 1]; a missing or malformed value is fully opaque.
const resolveCursorOpacity = (opacity: number | null): number => {
	if (opacity === null || Number.isNaN(opacity)) return OPAQUE_ALPHA
	if (opacity <= 0) return 0
	if (opacity >= OPAQUE_ALPHA) return OPAQUE_ALPHA
	return opacity
}

export const resolveCursor = (config: GhosttyConfig): ResolvedCursor => ({
	color: cursorColorFrom(config.cursor_color),
	textColor: cursorColorFrom(config.cursor_text),
	style: cursorStyleFrom(config.cursor_style),
	opacity: resolveCursorOpacity(config.cursor_opacity),
})
