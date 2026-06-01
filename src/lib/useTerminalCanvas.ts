import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'
import { AGENT_CELLS_EVENT } from '../state/sessions'

import type { CellFramePayload, TerminalTheme } from './terminalRenderer'
import { drawFrame, gridForSize, measureCell, syncBackingStore } from './terminalRenderer'

type TerminalCanvasHandles = {
	containerRef: RefObject<HTMLDivElement | null>
	canvasRef: RefObject<HTMLCanvasElement | null>
}

const propagateResize = (
	sessionId: string,
	cols: number,
	rows: number,
): void => {
	invoke('session_resize', { sessionId, cols, rows }).catch(
		(error: unknown) => {
			const { message, stack } = describeError(error)
			logger.warn(`useTerminalCanvas: session_resize failed: ${message}`, {
				scope: 'terminal-pane',
				details: { stack, sessionId, cols, rows },
			})
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

	useEffect(() => {
		const container = containerRef.current
		const canvas = canvasRef.current
		if (!container || !canvas) return

		const context = canvas.getContext('2d')
		if (!context) return

		// Default fg/bg live only in the --terminal-bg/--terminal-fg :root vars
		// (single source of truth, see App.css). Custom properties inherit, so we
		// read them off the canvas; they are static, so read once here, not per
		// frame. Values can carry leading whitespace, hence trim.
		const computed = getComputedStyle(canvas)
		const theme: TerminalTheme = {
			background: computed.getPropertyValue('--terminal-bg').trim(),
			foreground: computed.getPropertyValue('--terminal-fg').trim(),
		}

		// Font is fixed, so cell metrics are measured exactly once.
		const metrics = measureCell(context)
		let cssWidth = 0
		let cssHeight = 0
		let lastGrid: { cols: number; rows: number } | null = null

		const onResize = (width: number, height: number): void => {
			cssWidth = width
			cssHeight = height
			// Hold-frame: stretch the element over the existing bitmap. The
			// backing store stays put until the next frame repaints it crisply.
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
			drawFrame(context, event.payload, metrics, theme)
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
						{ scope: 'terminal-pane', details: { stack, sessionId } },
					)
				})
		}
	}, [sessionId])

	return { containerRef, canvasRef }
}
