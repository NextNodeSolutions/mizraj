import { invoke } from '@tauri-apps/api/core'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

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

// The font the canvas renderer actually draws with, resolved from the config
// with the built-in defaults as fallback. Pure: same config in, same metrics
// out — no IO, no canvas measurement (that is the renderer's measureCell job).
export type ResolvedFont = {
	familyCss: string
	sizePx: number
	lineHeightRatio: number
}

// Append the built-in monospace stack so a single missing family still has the
// same fallbacks the renderer has always had.
const familyStackFrom = (families: string[]): string => {
	if (families.length === 0) return DEFAULT_FONT_STACK
	return `${families.join(', ')}, ${DEFAULT_FONT_STACK}`
}

// Cell height (line box) relative to the font size, honoring adjust-cell-height.
//   - percent: scale the natural 1.2 ratio by (1 + value/100)
//   - absolute: add `value` device pixels to the natural line box, then express
//     that back as a ratio of the configured size
// Falls back to the natural 1.2 when there is no adjustment.
const lineHeightRatioFrom = (
	adjustment: Adjustment | null,
	sizePx: number,
): number => {
	if (!adjustment) return DEFAULT_LINE_HEIGHT_RATIO
	if (adjustment.kind === 'percent') {
		return (
			DEFAULT_LINE_HEIGHT_RATIO *
			(1 + adjustment.value / PERCENT_TO_FRACTION)
		)
	}
	const naturalLineHeight = sizePx * DEFAULT_LINE_HEIGHT_RATIO
	return (naturalLineHeight + adjustment.value) / sizePx
}

export const resolveFont = (config: GhosttyConfig): ResolvedFont => {
	const sizePx = config.font_size ?? DEFAULT_FONT_SIZE_PX
	return {
		familyCss: familyStackFrom(config.font_family),
		sizePx,
		lineHeightRatio: lineHeightRatioFrom(config.adjust_cell_height, sizePx),
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
