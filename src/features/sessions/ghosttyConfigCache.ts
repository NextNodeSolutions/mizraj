import { getDefaultStore } from 'jotai'

import type { Appearance, GhosttyConfig, ResolvedFont } from './ghosttyConfig'
import { resolveFont } from './ghosttyConfig'
import { ghosttyConfigEpochAtom } from './ghosttyConfigBridge'
import { loadGhosttyConfig } from './loadGhosttyConfig'
import { buildFontTable, fontCss } from './terminalAttrs'
import { buildPalette } from './terminalPalette'
import { measureCell } from './terminalRenderer'

// Everything startRendering derives from the resolved config that does NOT
// depend on the mounting pane: the config itself, the font resolution, the
// measured cell metrics, the per-attrs font table and the 256-color palette.
// Pane-specific pieces (CSS-var color fallbacks, cursor, alpha) stay derived
// per mount — they are cheap and read the live DOM.
export type RenderBundle = {
	config: GhosttyConfig
	font: ResolvedFont
	metrics: ReturnType<typeof measureCell>
	fontTable: readonly string[]
	palette: readonly string[]
}

// Promise-cached per appearance so concurrent mounts share one in-flight load
// (TP4: a session switch must not re-run loadGhosttyConfig + re-measure).
const bundles = new Map<Appearance, Promise<RenderBundle>>()

// The config epoch the cache was built against. Invalidation is pull-based:
// every get compares the live epoch (bumped by the hot-reload bridge) instead
// of subscribing at module scope, which keeps this module side-effect-free on
// import and deterministic under test.
let builtAtEpoch = -1

// Nerd/powerline glyphs live in the private use area; sampling one forces the
// bundled symbols fallback face to load too, not just the primary family.
const POWERLINE_SAMPLE = ''

// @font-face fonts (the bundled JetBrainsMono/symbols fallbacks) load lazily on
// first USE — measuring before the face is ready would cache interim-fallback
// metrics for the whole epoch. Resolve the faces the regular variant needs
// before measureCell runs; absent Font Loading API (jsdom) or a load failure,
// measurement proceeds with whatever the engine resolves.
const ensureFontFacesLoaded = async (font: ResolvedFont): Promise<void> => {
	if (typeof document === 'undefined' || !('fonts' in document)) return
	const regularCss = fontCss(font.regular, font.sizePx)
	await Promise.all([
		document.fonts.load(regularCss),
		document.fonts.load(regularCss, POWERLINE_SAMPLE),
	]).catch(() => undefined)
}

const buildBundle = async (
	appearance: Appearance,
	context: CanvasRenderingContext2D,
): Promise<RenderBundle> => {
	const config = await loadGhosttyConfig(appearance)
	const font = resolveFont(config)
	await ensureFontFacesLoaded(font)
	return {
		config,
		font,
		metrics: measureCell(context, font),
		fontTable: buildFontTable(font),
		palette: buildPalette(config.palette),
	}
}

// Resolve the render bundle for an appearance, hitting the cache when the
// config generation hasn't moved. `context` is only consulted on a miss (to
// measure the cell box); any 2D context measures identically for a given font.
export const getRenderBundle = (
	appearance: Appearance,
	context: CanvasRenderingContext2D,
): Promise<RenderBundle> => {
	const epoch = getDefaultStore().get(ghosttyConfigEpochAtom)
	if (epoch !== builtAtEpoch) {
		bundles.clear()
		builtAtEpoch = epoch
	}

	const cached = bundles.get(appearance)
	if (cached) return cached

	const bundle = buildBundle(appearance, context)
	bundles.set(appearance, bundle)
	return bundle
}

// Test-only escape hatch: suites verify miss/hit behavior from a clean slate.
export const resetRenderBundleCacheForTests = (): void => {
	bundles.clear()
	builtAtEpoch = -1
}
