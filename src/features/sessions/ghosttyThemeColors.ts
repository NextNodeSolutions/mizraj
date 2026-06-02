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
export const expandShortHex = (body: string): string => {
	if (body.length !== HEX_SHORT_LENGTH) return body
	return [...body].map(channel => `${channel}${channel}`).join('')
}

// The summed, weighted luminance (0..1) of a `#rgb`/`#rrggbb` background, or null
// when the string is not a hex literal (e.g. an `rgb(...)` or named color we
// cannot cheaply parse here). Pure: string in, number-or-null out.
export const hexLuminance = (color: string): number | null => {
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
export const contrastColor = (background: string): string => {
	const luminance = hexLuminance(background)
	if (luminance === null) return CONTRAST_LIGHT
	return luminance > LUMINANCE_MIDPOINT ? CONTRAST_DARK : CONTRAST_LIGHT
}
