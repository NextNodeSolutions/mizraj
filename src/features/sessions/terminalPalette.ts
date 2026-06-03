import type { PaletteEntry } from './ghosttyConfig'
import type { WireColor } from './terminalWire'

const ANSI_16 = [
	'#000000',
	'#cd0000',
	'#00cd00',
	'#cdcd00',
	'#0000ee',
	'#cd00cd',
	'#00cdcd',
	'#e5e5e5',
	'#7f7f7f',
	'#ff0000',
	'#00ff00',
	'#ffff00',
	'#5c5cff',
	'#ff00ff',
	'#00ffff',
	'#ffffff',
] as const

const CUBE_BASE = 16
const CUBE_END = 231
const CUBE_STEP = 40
const CUBE_OFFSET = 55
const CUBE_SIDE = 6
const CUBE_PLANE = CUBE_SIDE * CUBE_SIDE
const PALETTE_MAX_INDEX = 255
const GRAYSCALE_BASE = 232
const GRAYSCALE_START = 8
const GRAYSCALE_STEP = 10

const cubeChannel = (level: number): number =>
	level === 0 ? 0 : CUBE_OFFSET + level * CUBE_STEP

// The standard xterm 256-color table: ANSI 16 + a 6x6x6 color cube (16..231) +
// a 24-step grayscale ramp (232..255). Indices 16..255 already match Ghostty's
// defaults exactly, so this is the base layer a theme's `palette` overrides sit
// on top of (a full theme only ships 0..15).
const buildXtermDefaults = (): readonly string[] => {
	const palette: string[] = [...ANSI_16]

	for (let idx = CUBE_BASE; idx <= CUBE_END; idx += 1) {
		const n = idx - CUBE_BASE
		const r = cubeChannel(Math.floor(n / CUBE_PLANE))
		const g = cubeChannel(Math.floor((n % CUBE_PLANE) / CUBE_SIDE))
		const b = cubeChannel(n % CUBE_SIDE)
		palette.push(`rgb(${r}, ${g}, ${b})`)
	}

	for (let idx = GRAYSCALE_BASE; idx <= PALETTE_MAX_INDEX; idx += 1) {
		const v = GRAYSCALE_START + (idx - GRAYSCALE_BASE) * GRAYSCALE_STEP
		palette.push(`rgb(${v}, ${v}, ${v})`)
	}

	return palette
}

const XTERM_PALETTE = buildXtermDefaults()

// The 256-entry palette the renderer actually indexes: the xterm defaults with
// the Ghostty config's `palette` overrides applied on top (override index wins,
// non-overridden indices keep the xterm default). Built once per config — like
// the font table — and threaded in via TerminalConfig, never rebuilt per frame.
// Out-of-range override indices are ignored so a bad config never grows the
// array past 256 or punches holes in it. Lives here because the xterm defaults
// it layers onto are the renderer's; the dependency stays renderer -> config
// (it only borrows the PaletteEntry type), never the reverse.
export const buildPalette = (
	overrides: readonly PaletteEntry[],
): readonly string[] => {
	const palette = [...XTERM_PALETTE]

	for (const { index, color } of overrides) {
		if (index < 0 || index > PALETTE_MAX_INDEX) continue
		palette[index] = color
	}

	return palette
}

// The two colors a cell's `Color::Default` resolves to. Passed in by the caller
// rather than hardcoded so the `--terminal-bg`/`--terminal-fg` CSS variables stay
// the single source of truth (see useTerminalCanvas).
export type TerminalColors = {
	background: string
	foreground: string
}

// One resolver for both planes: the only difference is which theme color the
// terminal `default` resolves to, so the caller passes that as the fallback
// (also used when an indexed color is out of the 0..255 palette range). Indexed
// colors resolve against the per-config palette (xterm defaults + theme
// overrides), not the bare module-const defaults.
export const resolveColor = (
	color: WireColor,
	fallback: string,
	palette: readonly string[],
): string => {
	if (color.kind === 'default') return fallback
	if (color.kind === 'rgb') return `rgb(${color.r}, ${color.g}, ${color.b})`
	return palette[color.idx] ?? fallback
}

// The last standard ANSI index (0..7 are the normal colors) and the offset to
// each one's bright counterpart (8..15).
const ANSI_NORMAL_LAST = 7
const ANSI_BRIGHT_OFFSET = 8

// Ghostty's `bold-is-bright`: a bold glyph whose foreground is one of the eight
// standard ANSI colors (palette 0..7) is promoted to its bright counterpart
// (8..15). Bright colors, the 16..255 cube/grayscale, truecolor and the terminal
// default are all left untouched. Pure: maps a foreground wire color to the wire
// color the renderer should actually resolve.
export const brightenForBold = (
	color: WireColor,
	isBold: boolean,
	boldIsBright: boolean,
): WireColor => {
	if (!boldIsBright || !isBold) return color
	if (color.kind !== 'indexed' || color.idx > ANSI_NORMAL_LAST) return color
	return { kind: 'indexed', idx: color.idx + ANSI_BRIGHT_OFFSET }
}
