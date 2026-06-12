import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getDefaultStore, useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { useAppearance } from '@/features/settings/settings'
import { describeError, isSessionError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { GhosttyConfig } from './ghosttyConfig'
import {
	resolveBackgroundAlpha,
	resolveCursor,
	resolvePadding,
	resolveSelectionColors,
} from './ghosttyConfig'
import { fetchSessionFrame } from './fetchSessionFrame'
import { ghosttyConfigEpochAtom } from './ghosttyConfigBridge'
import type { RenderBundle } from './ghosttyConfigCache'
import { getRenderBundle } from './ghosttyConfigCache'
import { writeClipboardText } from './clipboard'
import { fontSizeDeltaAtom, sessionSelectionAtom } from './keybindRuntime'
import { cellFramesAtom } from './sessions'
import { findLinkAt } from './terminalLinks'
import type { GridLink } from './terminalLinks'
import {
	cellAtPoint,
	extractSelectionText,
	normalizeSelection,
} from './terminalMouse'
import type { CellPoint, SelectionRange } from './terminalMouse'
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

type MouseEventDto = {
	kind: 'press' | 'release' | 'motion' | 'wheel_up' | 'wheel_down'
	button: 'none' | 'left' | 'right' | 'middle'
	col: number
	row: number
	shift: boolean
	ctrl: boolean
	alt: boolean
}

// Best-effort like keystrokes: a dead session drops the event, the live
// flow's `mouse_reporting` flag stops the stream at the next frame anyway.
const forwardMouseEvent = (sessionId: string, event: MouseEventDto): void => {
	invoke('session_mouse', { sessionId, event }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`useTerminalCanvas: session_mouse failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, sessionId },
		})
	})
}

const MOUSE_BUTTONS: ReadonlyArray<MouseEventDto['button']> = [
	'left',
	'middle',
	'right',
]

// One wheel tick moves three rows, the terminal default Ghostty follows
// (mouse-scroll-multiplier=1 on a 3-line wheel notch).
const WHEEL_ROWS_PER_TICK = 3

const scrollViewport = (sessionId: string, rows: number): void => {
	invoke('session_scroll', {
		sessionId,
		request: { delta: { rows } },
	}).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.warn(`useTerminalCanvas: session_scroll failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack, sessionId },
		})
	})
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
		selection: resolveSelectionColors(ghosttyConfig),
	}

	// window-padding renders as container padding: the canvas (and so the
	// pixel->cell math) stays padding-free, and the ResizeObserver's
	// contentRect shrinks automatically.
	const padding = resolvePadding(ghosttyConfig)
	container.style.padding = `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`

	let cssWidth = 0
	let cssHeight = 0
	let lastGrid: { cols: number; rows: number } | null = null
	let lastFrame: CellFramePayload | null = null
	let blinkOn = true
	// Mouse selection (TP9): the anchor is set on press, the normalized range
	// drives the paint highlight, and the release extracts/copies the text.
	let selection: SelectionRange | null = null
	let dragAnchor: CellPoint | null = null
	// The link under the pointer (TP9): underlined, opened on cmd-click.
	let hoveredLink: GridLink | null = null

	const paint = (): void => {
		if (!lastFrame) return
		syncBackingStore(canvas, context, cssWidth, cssHeight)
		drawFrame(context, lastFrame, metrics, config, fontTable, {
			cursorBlinkOn: blinkOn,
			selection,
			hoveredLink,
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

	const cellFromEvent = (event: MouseEvent): CellPoint | null => {
		if (!lastGrid) return null
		const rect = canvas.getBoundingClientRect()
		return cellAtPoint(
			event.clientX - rect.left,
			event.clientY - rect.top,
			metrics,
			lastGrid,
		)
	}

	// Ghostty copies on select unless copy-on-select=false; both remaining
	// variants land on the OS clipboard here (no separate primary buffer).
	const copyOnSelect = ghosttyConfig.copy_on_select !== 'disabled'

	const finalizeSelection = (): void => {
		const store = getDefaultStore()
		const selections = store.get(sessionSelectionAtom)
		if (selection && lastFrame) {
			const text = extractSelectionText(lastFrame, selection)
			store.set(sessionSelectionAtom, {
				...selections,
				[sessionId]: text,
			})
			if (copyOnSelect && text) void writeClipboardText(text)
			return
		}
		// A plain click clears any stale selection for this session.
		if (sessionId in selections) {
			const { [sessionId]: _cleared, ...rest } = selections
			store.set(sessionSelectionAtom, rest)
		}
	}

	// App mouse mode (TP10): while the child tracks the mouse (vim, htop) and
	// shift is not held (Ghostty's local-selection override), events are
	// forwarded for PTY encoding instead of selecting. The decision latches at
	// press time (`forwardedButton`), so a mode flip mid-gesture cannot split
	// one drag across the two worlds.
	let forwardedButton: MouseEventDto['button'] | null = null
	let lastMotionCell: CellPoint | null = null

	const reportsMouse = (event: MouseEvent): boolean =>
		(lastFrame?.mouse_reporting ?? false) && !event.shiftKey

	const dtoFor = (
		kind: MouseEventDto['kind'],
		button: MouseEventDto['button'],
		cell: CellPoint,
		event: MouseEvent,
	): MouseEventDto => ({
		kind,
		button,
		col: cell.col,
		row: cell.row,
		shift: event.shiftKey,
		ctrl: event.ctrlKey,
		alt: event.altKey,
	})

	const sameLink = (a: GridLink | null, b: GridLink | null): boolean =>
		a === b ||
		(a !== null &&
			b !== null &&
			a.row === b.row &&
			a.startCol === b.startCol &&
			a.url === b.url)

	const refreshHover = (cell: CellPoint): void => {
		const link = lastFrame ? findLinkAt(lastFrame, cell) : null
		if (sameLink(hoveredLink, link)) return
		hoveredLink = link
		canvas.style.cursor = link ? 'pointer' : ''
		paint()
	}

	const onMouseDown = (event: MouseEvent): void => {
		const cell = cellFromEvent(event)
		if (!cell) return
		// Cmd-click opens the hovered link via the OS (plain clicks keep
		// selecting); Ghostty's affordance.
		if (event.metaKey && hoveredLink) {
			event.preventDefault()
			void openUrl(hoveredLink.url).catch((error: unknown) => {
				const { message } = describeError(error)
				logger.warn(`useTerminalCanvas: openUrl failed: ${message}`, {
					scope: 'terminal-pane',
					details: { url: hoveredLink?.url },
				})
			})
			return
		}
		if (reportsMouse(event)) {
			const button = MOUSE_BUTTONS[event.button] ?? 'none'
			forwardedButton = button
			lastMotionCell = cell
			forwardMouseEvent(sessionId, dtoFor('press', button, cell, event))
			return
		}
		if (event.button !== 0) return
		dragAnchor = cell
		selection = null
		paint()
	}

	const onMouseMove = (event: MouseEvent): void => {
		const cell = cellFromEvent(event)
		if (!cell) return
		if (forwardedButton !== null) {
			// Deduplicate per cell: motion inside one cell reports nothing new.
			if (
				lastMotionCell &&
				lastMotionCell.col === cell.col &&
				lastMotionCell.row === cell.row
			) {
				return
			}
			lastMotionCell = cell
			forwardMouseEvent(
				sessionId,
				dtoFor('motion', forwardedButton, cell, event),
			)
			return
		}
		if (!dragAnchor) {
			refreshHover(cell)
			return
		}
		selection = normalizeSelection({ anchor: dragAnchor, head: cell })
		paint()
	}

	const onMouseUp = (event: MouseEvent): void => {
		if (forwardedButton !== null) {
			const cell = cellFromEvent(event)
			if (cell) {
				forwardMouseEvent(
					sessionId,
					dtoFor('release', forwardedButton, cell, event),
				)
			}
			forwardedButton = null
			lastMotionCell = null
			return
		}
		if (event.button !== 0 || !dragAnchor) return
		dragAnchor = null
		finalizeSelection()
	}

	const onWheel = (event: WheelEvent): void => {
		event.preventDefault()
		if (reportsMouse(event)) {
			const cell = cellFromEvent(event)
			if (!cell) return
			forwardMouseEvent(
				sessionId,
				dtoFor(
					event.deltaY < 0 ? 'wheel_up' : 'wheel_down',
					'none',
					cell,
					event,
				),
			)
			return
		}
		// Outside app mouse mode the wheel walks the scrollback (TP6).
		const rows =
			event.deltaY < 0 ? -WHEEL_ROWS_PER_TICK : WHEEL_ROWS_PER_TICK
		scrollViewport(sessionId, rows)
	}

	// Press starts on the canvas; the drag may travel (and release) anywhere.
	canvas.addEventListener('mousedown', onMouseDown)
	window.addEventListener('mousemove', onMouseMove)
	window.addEventListener('mouseup', onMouseUp)
	canvas.addEventListener('wheel', onWheel, { passive: false })

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
		canvas.removeEventListener('mousedown', onMouseDown)
		window.removeEventListener('mousemove', onMouseMove)
		window.removeEventListener('mouseup', onMouseUp)
		canvas.removeEventListener('wheel', onWheel)
		unsubscribe()
	}
}
