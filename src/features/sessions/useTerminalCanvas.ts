import { invoke } from '@tauri-apps/api/core'
import { getDefaultStore, useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { useAppearance } from '@/features/settings/settings'
import { describeError, isSessionError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { GhosttyConfig } from './ghosttyConfig'
import { resolveBackgroundAlpha, resolveCursor } from './ghosttyConfig'
import { fetchSessionFrame } from './fetchSessionFrame'
import { ghosttyConfigEpochAtom } from './ghosttyConfigBridge'
import type { RenderBundle } from './ghosttyConfigCache'
import { getRenderBundle } from './ghosttyConfigCache'
import { fontSizeDeltaAtom } from './keybindRuntime'
import { cellFramesAtom } from './sessions'
import { subscribeToCellFrames } from './sessionSubscription'
import { buildFontTable } from './terminalAttrs'
import type { TerminalConfig } from './terminalRenderer'
import {
	drawFrame,
	gridForSize,
	measureCell,
	syncBackingStore,
} from './terminalRenderer'
import type { CellFramePayload } from './terminalWire'

type TerminalCanvasHandles = {
	containerRef: RefObject<HTMLDivElement | null>
	canvasRef: RefObject<HTMLCanvasElement | null>
}

// The cursor blink half-period (xterm's ~530ms): each tick toggles the phase.
const CURSOR_BLINK_INTERVAL_MS = 530

// The two default colors prefer the Ghostty config's bg/fg (e.g. a theme's
// `#eff1f5`/`#4c4f69`); when the config leaves them null, fall back to the
// --terminal-bg/--terminal-fg :root vars (the pre-config source of truth, see
// App.css). CSS vars are read once per effect run, not per frame, and can carry
// leading whitespace, hence trim.
const resolveTerminalColors = (
	canvas: HTMLCanvasElement,
	config: GhosttyConfig,
): TerminalConfig['colors'] => {
	const computed = getComputedStyle(canvas)
	return {
		background:
			config.background ??
			computed.getPropertyValue('--terminal-bg').trim(),
		foreground:
			config.foreground ??
			computed.getPropertyValue('--terminal-fg').trim(),
	}
}

const propagateResize = (
	sessionId: string,
	cols: number,
	rows: number,
): void => {
	invoke('session_resize', { sessionId, cols, rows }).catch(
		(error: unknown) => {
			if (isSessionError(error) && error.kind === 'not_found') {
				logger.debug(
					'useTerminalCanvas: session_resize skipped, session gone (expected during teardown)',
					{
						scope: 'terminal-pane',
						details: { sessionId, cols, rows },
					},
				)
				return
			}

			const { message, stack } = describeError(error)
			logger.warn(
				`useTerminalCanvas: session_resize failed: ${message}`,
				{
					scope: 'terminal-pane',
					details: { stack, sessionId, cols, rows },
				},
			)
		},
	)
}

// One effect owns the whole canvas lifecycle for a session: context, metrics,
// the cell-frame listener, and the resize observer. Resize and paint are kept
// separate on purpose:
//
//   - A resize tick only stretches the canvas ELEMENT (CSS) over the current
//     bitmap and asks the backend to reflow. The browser scales the last frame
//     to fill — a hold-frame, exactly what a GPU terminal does — so there is no
//     blank flash and no stale-width redraw mid-drag.
//   - The crisp BACKING-STORE resize happens only when the reflowed frame lands
//     (drawFrame paints it immediately, so the resize clear is never seen).
//
// Everything that doesn't cross a React render is a closure local, so the only
// refs are the two DOM handles. Re-running on `sessionId` gives each session a
// fresh, self-contained scope.
export const useTerminalCanvas = (sessionId: string): TerminalCanvasHandles => {
	const containerRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const appearance = useAppearance()
	// Hot reload (DG3): an on-disk config edit bumps the epoch, tearing the
	// render scope down and rebuilding it against the fresh config.
	const configEpoch = useAtomValue(ghosttyConfigEpochAtom)
	// Interactive font-size keybinds shift this delta; the render scope
	// re-derives metrics from it without touching the per-appearance cache.
	const fontSizeDelta = useAtomValue(fontSizeDeltaAtom)

	// Subscription is keyed on the session alone — an appearance flip must not
	// blink the backend's emission gate, only re-derive the render config below.
	useEffect(() => subscribeToCellFrames(sessionId), [sessionId])

	useEffect(() => {
		const container = containerRef.current
		const canvas = canvasRef.current
		if (!container || !canvas) return

		const context = canvas.getContext('2d')
		if (!context) return

		// The cell-frame listener and resize observer can only be wired once the
		// font is known, because cell metrics (and thus the grid the backend
		// resizes to) depend on it. The bundle resolves from the per-appearance
		// cache (TP4) — instant on a session switch, an actual load only on the
		// first mount or after a hot reload. Still async, so a `cancelled`
		// guard drops a late resolution onto a torn-down scope: the effect may
		// re-run (sessionId/appearance/config change) or unmount before it
		// lands. The torn-down listener/observer are released by the cleanup.
		let cancelled = false
		let teardown: (() => void) | null = null

		void getRenderBundle(appearance, context).then(bundle => {
			if (cancelled) return
			teardown = startRendering(
				context,
				container,
				canvas,
				sessionId,
				applyFontSizeDelta(bundle, fontSizeDelta, context),
			)
		})

		return () => {
			cancelled = true
			teardown?.()
		}
	}, [sessionId, appearance, configEpoch, fontSizeDelta])

	return { containerRef, canvasRef }
}

// The smallest font the canvas can still tile cells with; decrease_font_size
// keybinds clamp here instead of inverting the grid math.
const MIN_FONT_SIZE_PX = 4

// Re-derive the size-dependent half of the bundle when the interactive
// font-size delta is non-zero. The cache stays pristine (keyed by appearance
// only): font-size steps are rare, the re-measure costs microseconds, and
// reset_font_size lands back on the cached bundle object untouched.
const applyFontSizeDelta = (
	bundle: RenderBundle,
	delta: number,
	context: CanvasRenderingContext2D,
): RenderBundle => {
	if (delta === 0) return bundle
	const sizePx = Math.max(MIN_FONT_SIZE_PX, bundle.font.sizePx + delta)
	const font = { ...bundle.font, sizePx }
	return {
		...bundle,
		font,
		metrics: measureCell(context, font),
		fontTable: buildFontTable(font),
	}
}

// Wire the cell-frame listener and resize observer for a session against the
// cached render bundle, returning a teardown that releases both. Split out of
// the effect so the effect body stays wiring + cleanup (it only awaits the
// bundle and delegates). Config-only derivations (font, metrics, font table,
// palette) arrive precomputed in the bundle (TP4); only the pane-coupled
// pieces — CSS-var color fallbacks, cursor, background alpha — are derived
// here, per mount.
const startRendering = (
	context: CanvasRenderingContext2D,
	container: HTMLDivElement,
	canvas: HTMLCanvasElement,
	sessionId: string,
	bundle: RenderBundle,
): (() => void) => {
	const { config: ghosttyConfig, font, metrics, fontTable, palette } = bundle
	const config: TerminalConfig = {
		colors: resolveTerminalColors(canvas, ghosttyConfig),
		font,
		palette,
		backgroundAlpha: resolveBackgroundAlpha(ghosttyConfig),
		cursor: resolveCursor(ghosttyConfig),
		boldIsBright: ghosttyConfig.bold_is_bright ?? false,
	}

	let cssWidth = 0
	let cssHeight = 0
	let lastGrid: { cols: number; rows: number } | null = null
	let lastFrame: CellFramePayload | null = null
	let blinkOn = true

	const paint = (): void => {
		if (!lastFrame) return
		syncBackingStore(canvas, context, cssWidth, cssHeight)
		drawFrame(context, lastFrame, metrics, config, fontTable, {
			cursorBlinkOn: blinkOn,
		})
	}

	const onResize = (width: number, height: number): void => {
		cssWidth = width
		cssHeight = height
		// Hold-frame: stretch the element over the existing bitmap. The backing
		// store stays put until the next frame repaints it crisply.
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`

		const { cols, rows } = gridForSize(width, height, metrics)
		if (lastGrid && lastGrid.cols === cols && lastGrid.rows === rows) return
		lastGrid = { cols, rows }
		propagateResize(sessionId, cols, rows)
	}

	const store = getDefaultStore()

	const applyFrame = (frame: CellFramePayload): void => {
		lastFrame = frame
		// Activity makes the cursor solid again; it resumes blinking from there.
		blinkOn = true
		paint()
	}

	// Read this session's latest frame from the global agent:cells bridge and
	// repaint when it changes. The bridge keeps the same frame object for sessions
	// it didn't touch, so the reference check skips repaints driven by *other*
	// sessions' frames.
	const consumeSessionFrame = (): void => {
		const frame = store.get(cellFramesAtom)[sessionId]
		if (frame && frame !== lastFrame) applyFrame(frame)
	}

	const unsubscribe = store.sub(cellFramesAtom, consumeSessionFrame)

	const blinkTimer = setInterval(() => {
		if (!lastFrame?.cursor?.blink) return
		blinkOn = !blinkOn
		paint()
	}, CURSOR_BLINK_INTERVAL_MS)

	const observer = new ResizeObserver(entries => {
		const rect = entries[entries.length - 1]?.contentRect
		if (rect) onResize(rect.width, rect.height)
	})
	observer.observe(container)

	const initial = container.getBoundingClientRect()
	onResize(initial.width, initial.height)

	// store.sub doesn't fire on subscribe, so paint any frame the global bridge
	// already buffered before this pane mounted (now that cssWidth/cssHeight are set).
	consumeSessionFrame()

	// Seed the first paint by pulling the current grid (TP1): an idle session
	// emits nothing on its own, so without this an unbuffered pane would stay
	// blank until the next output. Anything that landed meanwhile (bridge
	// buffer, catch-up frame, live flow) is at least as fresh — the pull only
	// fills a still-empty pane, and never one that has been torn down.
	let stopped = false
	void fetchSessionFrame(sessionId).then(frame => {
		if (frame && !stopped && !lastFrame) applyFrame(frame)
	})

	return () => {
		stopped = true
		clearInterval(blinkTimer)
		observer.disconnect()
		unsubscribe()
	}
}
