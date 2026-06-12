import { listen } from '@tauri-apps/api/event'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { CellFramePayload } from './terminalWire'

export type OutputChunkKind = 'stdout' | 'stderr'

export type OutputChunk = {
	kind: OutputChunkKind
	text: string
}

export type SessionStatus = 'running' | 'ended'

export type SessionState = {
	id: string
	/// The spawned program ('claude' for agent runs, the user's shell for
	/// plain terminals) — what the sidebar labels the session with.
	binary: string
	/// The repo the session was launched in — what a split spawned from this
	/// session inherits as its working directory.
	repoPath: string | null
	/// The OSC 0/2 title the program set, when any — overrides the derived
	/// label while present (TP13).
	title: string | null
	output: ReadonlyArray<OutputChunk>
	status: SessionStatus
	exitCode: number | null
	/// Epoch ms the session was registered — what relative "age" labels are
	/// computed from.
	startedAt: number
}

export type AgentOutputPayload = {
	session_id: string
	kind: OutputChunkKind
	text: string
}

export type SessionEndPayload = {
	session_id: string
	exit_code: number
}

export const AGENT_OUTPUT_EVENT = 'agent:output'

export const AGENT_END_EVENT = 'agent:end'

export const AGENT_CELLS_EVENT = 'agent:cells'

export const AGENT_TITLE_EVENT = 'agent:title'

export type TitlePayload = {
	session_id: string
	title: string | null
}

type SessionsMap = Readonly<Record<string, SessionState>>

export const sessionsAtom = atom<SessionsMap>({})

type StartSessionArgs = { id: string; binary: string; repoPath: string | null }

export const startSessionAtom = atom(
	null,
	(get, set, { id, binary, repoPath }: StartSessionArgs) => {
		set(sessionsAtom, {
			...get(sessionsAtom),
			[id]: {
				id,
				binary,
				repoPath,
				title: null,
				output: [],
				status: 'running',
				exitCode: null,
				startedAt: Date.now(),
			},
		})
	},
)

type AppendOutputArgs = { sessionId: string; chunk: OutputChunk }

export const appendOutputAtom = atom(
	null,
	(get, set, { sessionId, chunk }: AppendOutputArgs) => {
		const sessions = get(sessionsAtom)
		const existing = sessions[sessionId]
		if (!existing) return
		set(sessionsAtom, {
			...sessions,
			[sessionId]: {
				...existing,
				output: [...existing.output, chunk],
			},
		})
	},
)

type SetTitleArgs = { sessionId: string; title: string | null }

export const setSessionTitleAtom = atom(
	null,
	(get, set, { sessionId, title }: SetTitleArgs) => {
		const sessions = get(sessionsAtom)
		const existing = sessions[sessionId]
		if (!existing) return
		set(sessionsAtom, {
			...sessions,
			[sessionId]: { ...existing, title },
		})
	},
)

type EndSessionArgs = { sessionId: string; exitCode: number | null }

export const endSessionAtom = atom(
	null,
	(get, set, { sessionId, exitCode }: EndSessionArgs) => {
		const sessions = get(sessionsAtom)
		const existing = sessions[sessionId]
		if (!existing) return
		set(sessionsAtom, {
			...sessions,
			[sessionId]: { ...existing, status: 'ended', exitCode },
		})
	},
)

type CellFramesMap = Readonly<Record<string, CellFramePayload>>

// The single global home for the latest cell frame per session. A pane that
// remounts reads the last frame from here instead of racing a per-pane
// agent:cells listen, so it repaints immediately rather than staying blank
// until the next live frame.
export const cellFramesAtom = atom<CellFramesMap>({})

export const setCellFrameAtom = atom(
	null,
	(get, set, frame: CellFramePayload) => {
		set(cellFramesAtom, {
			...get(cellFramesAtom),
			[frame.session_id]: frame,
		})
	},
)

// Which session currently owns the keyboard. Decoupled from DOM focus on
// purpose: the terminal is the app's centre of gravity, so keystrokes flow to
// the active pane without a click-to-focus step. With a single pane it's just
// that pane; once Ghostty-style splits land, focus-follows-mouse keeps exactly
// one pane active so the keystroke is never broadcast to every terminal.
export const activeSessionIdAtom = atom<string | null>(null)

// A pane claims the keyboard when it mounts or the pointer enters it.
export const claimActiveSessionAtom = atom(
	null,
	(_get, set, sessionId: string) => {
		set(activeSessionIdAtom, sessionId)
	},
)

// A pane releases the keyboard on unmount — but only if it's still the active
// one, so a sibling pane that already claimed focus isn't wrongly cleared.
export const releaseActiveSessionAtom = atom(
	null,
	(get, set, sessionId: string) => {
		if (get(activeSessionIdAtom) === sessionId) {
			set(activeSessionIdAtom, null)
		}
	},
)

let bridgeStarted = false

// Idempotent — safe to call multiple times even though main.tsx only calls
// once; HMR + tests can re-import without double-subscribing.
export const startAgentEventsBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	const store = getDefaultStore()

	// Subscribe to a per-session Tauri event, dropping (with a warning) any
	// payload whose session we don't know about, and resetting the bridge on a
	// failed subscription so a later startAgentEventsBridge() can retry.
	const forwardSessionEvent = <T extends { session_id: string }>(
		event: string,
		route: (payload: T) => void,
	): void => {
		listen<T>(event, ({ payload }) => {
			if (!store.get(sessionsAtom)[payload.session_id]) {
				logger.warn(
					`${event} for unknown session ${payload.session_id}; dropping`,
					{ scope: 'sessions-store' },
				)
				return
			}
			route(payload)
		}).catch((error: unknown) => {
			bridgeStarted = false
			const { message, stack } = describeError(error)
			logger.error(
				`startAgentEventsBridge: listen('${event}') failed: ${message}`,
				{ scope: 'sessions-store', details: { stack } },
			)
		})
	}

	forwardSessionEvent<AgentOutputPayload>(
		AGENT_OUTPUT_EVENT,
		({ session_id, kind, text }) => {
			store.set(appendOutputAtom, {
				sessionId: session_id,
				chunk: { kind, text },
			})
		},
	)

	forwardSessionEvent<SessionEndPayload>(
		AGENT_END_EVENT,
		({ session_id, exit_code }) => {
			store.set(endSessionAtom, {
				sessionId: session_id,
				exitCode: exit_code,
			})
		},
	)

	forwardSessionEvent<CellFramePayload>(AGENT_CELLS_EVENT, frame => {
		store.set(setCellFrameAtom, frame)
	})

	forwardSessionEvent<TitlePayload>(
		AGENT_TITLE_EVENT,
		({ session_id, title }) => {
			store.set(setSessionTitleAtom, { sessionId: session_id, title })
		},
	)
}

// Test-only escape hatch so suites can verify idempotency from a clean slate.
export const resetAgentEventsBridgeForTests = (): void => {
	bridgeStarted = false
}
