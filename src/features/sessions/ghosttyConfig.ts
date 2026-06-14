import type { WireCursorStyle } from './terminalWire'

// The current renderer defaults, kept verbatim as the fallback so behavior is
// unchanged when the user has no Ghostty config (or it carries no font keys).
// The font size doubles as a points value: Ghostty's `font-size` is in points,
// but the canvas has always treated 13 as pixels, so we keep 1pt = 1px for now
// (see M2 in the parity ADR for true pt -> px scaling).
const DEFAULT_FONT_SIZE_PX = 13
const DEFAULT_LINE_HEIGHT_RATIO = 1.2
const PERCENT_TO_FRACTION = 100
// The bundled JetBrainsMono Nerd Font (App.css @font-face) leads the default
// stack — Ghostty parity: a missing configured family falls back to a font
// with ligatures and Nerd glyphs, not Menlo.
export const DEFAULT_FONT_STACK =
	'"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

// Per-glyph fallback inserted after the user's configured families: a font
// that lacks Nerd/powerline glyphs (private-use-area codepoints) borrows them
// from the bundled symbols face, like Ghostty's embedded symbols fallback.
export const GLYPH_FALLBACK_STACK = `"Symbols Nerd Font Mono", ${DEFAULT_FONT_STACK}`

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

// A trigger key, tagged by matching mode: logical follows the keyboard layout
// (KeyboardEvent.key), physical the position (KeyboardEvent.code).
export type KeySpec =
	| { kind: 'logical'; name: string }
	| { kind: 'physical'; name: string }

// One key with its modifiers, pressed at once.
export type KeyChord = {
	shift: boolean
	ctrl: boolean
	alt: boolean
	super: boolean
	key: KeySpec
}

export type KeybindFlags = {
	global: boolean
	all: boolean
	unconsumed: boolean
	performable: boolean
}

// Where new_split places the pane / where goto_split moves focus.
export type SplitDirection = 'right' | 'down' | 'left' | 'up' | 'auto'
export type SplitFocus = 'previous' | 'next' | 'left' | 'right' | 'up' | 'down'

// The typed action half of a keybind (TP8). `unsupported` carries a verbatim
// out-of-scope Ghostty action the dispatch must skip (and let the key fall
// through to the PTY encoder).
export type KeybindAction =
	| { kind: 'copy_to_clipboard' }
	| { kind: 'paste_from_clipboard' }
	| { kind: 'paste_from_selection' }
	| { kind: 'select_all' }
	| { kind: 'increase_font_size'; amount: number }
	| { kind: 'decrease_font_size'; amount: number }
	| { kind: 'reset_font_size' }
	| { kind: 'clear_screen' }
	| { kind: 'reset' }
	| { kind: 'scroll_to_top' }
	| { kind: 'scroll_to_bottom' }
	| { kind: 'scroll_page_up' }
	| { kind: 'scroll_page_down' }
	| { kind: 'text'; text: string }
	| { kind: 'esc'; sequence: string }
	| { kind: 'new_split'; direction: SplitDirection }
	| { kind: 'goto_split'; focus: SplitFocus }
	| { kind: 'close_surface' }
	| { kind: 'ignore' }
	| { kind: 'unsupported'; action: string }

// One effective keybinding: chord sequence (length > 1 = leader sequence),
// flags, action — already folded (rebinds replaced, unbinds removed).
export type Keybind = {
	trigger: KeyChord[]
	flags: KeybindFlags
	action: KeybindAction
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
	macos_option_as_alt: string | null
	term: string | null
	keybinds: Keybind[]
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
	macos_option_as_alt: null,
	term: null,
	keybinds: [],
	diagnostics: [],
}

// Which Option side(s) act as Alt/Meta for the PTY. Ghostty's macOS default is
// `false`: Option composes layout characters (é, |, {…}) and never ESC-prefixes.
export type OptionAsAlt = 'none' | 'left' | 'right' | 'both'

export const resolveOptionAsAlt = (config: GhosttyConfig): OptionAsAlt => {
	switch (config.macos_option_as_alt) {
		case 'true':
			return 'both'
		case 'left':
			return 'left'
		case 'right':
			return 'right'
		default:
			return 'none'
	}
}

// selection-background/-foreground for the renderer. The cell-foreground/
// cell-background sentinels need per-cell resolution the canvas pass doesn't
// do yet — they fall back to reverse video like an absent key.
export type SelectionColors = {
	background: string | null
	foreground: string | null
}

const CELL_COLOR_SENTINELS = new Set(['cell-foreground', 'cell-background'])

const plainColor = (value: string | null): string | null =>
	value !== null && !CELL_COLOR_SENTINELS.has(value) ? value : null

export const resolveSelectionColors = (
	config: GhosttyConfig,
): SelectionColors => ({
	background: plainColor(config.selection_background),
	foreground: plainColor(config.selection_foreground),
})

// window-padding-x/y as CSS padding around the canvas (Ghostty defaults both
// axes to 2). x = left/right, y = top/bottom; window-padding-balance is not
// honored yet (it redistributes the sub-cell leftover, a cosmetic refinement).
export type TerminalPadding = {
	top: number
	right: number
	bottom: number
	left: number
}

const DEFAULT_WINDOW_PADDING = 2

export const resolvePadding = (config: GhosttyConfig): TerminalPadding => ({
	top: config.window_padding_y?.start ?? DEFAULT_WINDOW_PADDING,
	bottom: config.window_padding_y?.end ?? DEFAULT_WINDOW_PADDING,
	left: config.window_padding_x?.start ?? DEFAULT_WINDOW_PADDING,
	right: config.window_padding_x?.end ?? DEFAULT_WINDOW_PADDING,
})

export type Appearance = 'light' | 'dark'

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

// Append the built-in fallbacks behind the configured families. The symbols
// face slots between them so user fonts without Nerd glyphs still render
// icons; with no families at all, the default stack's JetBrainsMono Nerd Font
// already carries its own symbols. Shared by the canvas font resolution below
// and the app-wide --font-mono token (useGhosttyTheme).
export const familyStackFrom = (families: string[]): string => {
	if (families.length === 0) return DEFAULT_FONT_STACK
	return `${families.join(', ')}, ${GLYPH_FALLBACK_STACK}`
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
	if (opacity === null || Number.isNaN(opacity)) return OPAQUE_ALPHA
	if (opacity <= 0 || opacity >= OPAQUE_ALPHA) return OPAQUE_ALPHA
	return opacity
}

// The cursor settings the renderer draws with, resolved from the config. `color`
// and `style` are null when the config leaves them unset, so the renderer falls
// back to the terminal foreground / the frame's reported style respectively.
// `textColor` is the glyph color shown under a block cursor (cursor invert).
// `blink` is cursor-style-blink verbatim: null = unset, meaning Ghostty's
// out-of-box behavior (blinking) unless the frame reports a child-set state.
export type ResolvedCursor = {
	color: string | null
	textColor: string | null
	style: WireCursorStyle | null
	blink: boolean | null
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
	blink: config.cursor_style_blink,
	opacity: resolveCursorOpacity(config.cursor_opacity),
})
