import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { useSettings } from '@/features/settings/settings'
import type { Theme } from '@/features/settings/settings'
import { describeError, isSessionError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { Appearance } from './ghosttyConfig'
import { loadGhosttyConfig, resolveFont } from './ghosttyConfig'
import { AGENT_CELLS_EVENT } from './sessions'
import type { CellFramePayload, TerminalConfig } from './terminalRenderer'
import {
	buildFontTable,
	drawFrame,
	gridForSize,
	measureCell,
	syncBackingStore,
} from './terminalRenderer'

type TerminalCanvasHandles = {
	containerRef: RefObject<HTMLDivElement | null>
	canvasRef: RefObject<HTMLCanvasElement | null>
}

// Map the user's theme setting onto the light/dark axis the Ghostty config
// loader keys off; `system` follows the OS preference. Pure: no effect needed,
// it is derived from the setting and the media query on every render.
const appearanceFor = (theme: Theme): Appearance => {
	if (theme === 'light') return 'light'
	if (theme === 'dark') return 'dark'
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

// The two default colors come straight from the --terminal-bg/--terminal-fg
// :root vars (single source of truth, see App.css). Static, so read once per
// effect run, not per frame. Values can carry leading whitespace, hence trim.
const readTerminalColors = (
	canvas: HTMLCanvasElement,
): TerminalConfig['colors'] => {
	const computed = getComputedStyle(canvas)
	return {
		background: computed.getPropertyValue('--terminal-bg').trim(),
		foreground: computed.getPropertyValue('--terminal-fg').trim(),
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
	const { theme } = useSettings()
	const appearance = appearanceFor(theme)

	useEffect(() => {
		const container = containerRef.current
		const canvas = canvasRef.current
		if (!container || !canvas) return

		const context = canvas.getContext('2d')
		if (!context) return

		// The cell-frame listener and resize observer can only be wired once the
		// font is known, because cell metrics (and thus the grid the backend
		// resizes to) depend on it. The config fetch is async, so a `cancelled`
		// guard drops a late resolution onto a torn-down scope: the effect may
		// re-run (sessionId/appearance change) or unmount before it lands. The
		// torn-down listener/observer are released by the returned cleanup.
		let cancelled = false
		let teardown: (() => void) | null = null

		void loadGhosttyConfig(appearance).then(ghosttyConfig => {
			if (cancelled) return
			teardown = startRendering(
				context,
				container,
				canvas,
				sessionId,
				resolveFont(ghosttyConfig),
			)
		})

		return () => {
			cancelled = true
			teardown?.()
		}
	}, [sessionId, appearance])

	return { containerRef, canvasRef }
}

// Wire the cell-frame listener and resize observer for a session at a known
// font, returning a teardown that releases both. Split out of the effect so the
// effect body stays wiring + cleanup (it only awaits the font and delegates);
// the resize/hold-frame architecture and the once-per-font metric measurement
// live here, where the font is finally available.
const startRendering = (
	context: CanvasRenderingContext2D,
	container: HTMLDivElement,
	canvas: HTMLCanvasElement,
	sessionId: string,
	font: TerminalConfig['font'],
): (() => void) => {
	const config: TerminalConfig = {
		colors: readTerminalColors(canvas),
		font,
	}

	// Metrics and the per-attrs font table depend only on the font, so they are
	// built once per font here rather than per frame.
	const metrics = measureCell(context, font)
	const fontTable = buildFontTable(font)
	let cssWidth = 0
	let cssHeight = 0
	let lastGrid: { cols: number; rows: number } | null = null

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

	const unlisten = listen<CellFramePayload>(AGENT_CELLS_EVENT, event => {
		if (event.payload.session_id !== sessionId) return
		syncBackingStore(canvas, context, cssWidth, cssHeight)
		drawFrame(context, event.payload, metrics, config, fontTable)
	})

	const observer = new ResizeObserver(entries => {
		const rect = entries[entries.length - 1]?.contentRect
		if (rect) onResize(rect.width, rect.height)
	})
	observer.observe(container)

	const initial = container.getBoundingClientRect()
	onResize(initial.width, initial.height)

	return () => {
		observer.disconnect()
		unlisten
			.then(stop => stop())
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.warn(
					`useTerminalCanvas: agent:cells unlisten failed: ${message}`,
					{
						scope: 'terminal-pane',
						details: { stack, sessionId },
					},
				)
			})
	}
}
