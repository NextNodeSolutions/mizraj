import { invoke } from '@tauri-apps/api/core'
import { FitAddon, init, Terminal } from 'ghostty-web'
import { useEffect, useRef, useState } from 'react'

import { describeError } from '../errors'
import { useSession } from '../lib/useSession'
import { logger } from '../logger'

// ghostty-web loads a wasm module on `init()`. Memoize the call so the module
// is fetched/instantiated once and shared across every session mount instead of
// re-initialized per `<GhosttyLog>`.
let ghosttyInit: Promise<void> | null = null
const ensureGhosttyInit = (): Promise<void> => {
	ghosttyInit ??= init().catch((error: unknown) => {
		// Let a later mount retry instead of caching the failure forever.
		ghosttyInit = null
		throw error
	})
	return ghosttyInit
}

const propagateResize = (
	sessionId: string,
	cols: number,
	rows: number,
): void => {
	invoke('session_resize', { sessionId, cols, rows }).catch(
		(error: unknown) => {
			const { message, stack } = describeError(error)
			logger.warn(`GhosttyLog: session_resize failed: ${message}`, {
				scope: 'ghostty-log',
				details: { stack, sessionId, cols, rows },
			})
		},
	)
}

type Props = {
	sessionId: string
}

const TERMINAL_OPTIONS = {
	cursorBlink: false,
	fontSize: 13,
	fontFamily:
		'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
	theme: {
		background: '#1e1e1e',
		foreground: '#e6e6e6',
	},
	scrollback: 10000,
}

const GhosttyLog = ({ sessionId }: Props): React.JSX.Element => {
	const containerRef = useRef<HTMLDivElement>(null)
	const [term, setTerm] = useState<Terminal | null>(null)
	const lastWrittenRef = useRef(0)
	const session = useSession(sessionId)

	// Owns the whole terminal lifecycle: the emulator, its FitAddon
	// (ResizeObserver), and the resize listener are all created here and torn
	// down by `dispose()`, which cascades to every loaded addon and emitter.
	useEffect(() => {
		let cancelled = false
		let createdTerm: Terminal | null = null

		const setup = async (): Promise<void> => {
			try {
				await ensureGhosttyInit()
			} catch (error: unknown) {
				const { message, stack } = describeError(error)
				logger.error(
					`GhosttyLog: ghostty-web init failed: ${message}`,
					{
						scope: 'ghostty-log',
						details: { stack, sessionId },
					},
				)
				return
			}
			if (cancelled || !containerRef.current) return
			const t = new Terminal(TERMINAL_OPTIONS)
			const fit = new FitAddon()
			t.loadAddon(fit)
			t.open(containerRef.current)
			fit.fit()
			fit.observeResize()
			createdTerm = t
			lastWrittenRef.current = 0
			// `fit()` already ran before the listener is attached, so emit the
			// initial dimensions explicitly; later container resizes flow through
			// `onResize`.
			propagateResize(sessionId, t.cols, t.rows)
			t.onResize(({ cols, rows }) =>
				propagateResize(sessionId, cols, rows),
			)
			setTerm(t)
		}

		void setup()

		return () => {
			cancelled = true
			createdTerm?.dispose()
			setTerm(null)
		}
	}, [sessionId])

	useEffect(() => {
		if (!term) return
		const output = session?.output ?? []
		if (output.length <= lastWrittenRef.current) return
		for (let i = lastWrittenRef.current; i < output.length; i += 1) {
			const chunk = output[i]
			if (chunk) term.write(chunk.text)
		}
		lastWrittenRef.current = output.length
	}, [term, session?.output])

	return <div ref={containerRef} className="ghostty-log" />
}

export default GhosttyLog
