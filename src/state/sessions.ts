import { listen } from '@tauri-apps/api/event'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '../errors'
import { logger } from '../logger'

export type OutputChunkKind = 'stdout' | 'stderr'

export type OutputChunk = {
	kind: OutputChunkKind
	text: string
}

export type SessionStatus = 'running' | 'ended'

export type SessionState = {
	id: string
	output: ReadonlyArray<OutputChunk>
	status: SessionStatus
	exitCode: number | null
}

export type AgentOutputPayload = {
	session_id: string
	kind: OutputChunkKind
	text: string
}

export const AGENT_OUTPUT_EVENT = 'agent:output'

type SessionsMap = Readonly<Record<string, SessionState>>

export const sessionsAtom = atom<SessionsMap>({})

export const startSessionAtom = atom(null, (get, set, sessionId: string) => {
	set(sessionsAtom, {
		...get(sessionsAtom),
		[sessionId]: {
			id: sessionId,
			output: [],
			status: 'running',
			exitCode: null,
		},
	})
})

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

let bridgeStarted = false

// Idempotent — safe to call multiple times even though main.tsx only calls
// once; HMR + tests can re-import without double-subscribing.
export const startAgentEventsBridge = (): void => {
	if (bridgeStarted) return
	bridgeStarted = true

	const store = getDefaultStore()
	listen<AgentOutputPayload>(AGENT_OUTPUT_EVENT, event => {
		const { session_id, kind, text } = event.payload
		if (!store.get(sessionsAtom)[session_id]) {
			logger.warn(
				`agent:output for unknown session ${session_id}; dropping chunk`,
				{
					scope: 'sessions-store',
					details: { kind, bytes: text.length },
				},
			)
			return
		}
		store.set(appendOutputAtom, {
			sessionId: session_id,
			chunk: { kind, text },
		})
	}).catch((error: unknown) => {
		bridgeStarted = false
		const { message, stack } = describeError(error)
		logger.error(
			`startAgentEventsBridge: listen('${AGENT_OUTPUT_EVENT}') failed: ${message}`,
			{ scope: 'sessions-store', details: { stack } },
		)
	})
}

// Test-only escape hatch so suites can verify idempotency from a clean slate.
export const resetAgentEventsBridgeForTests = (): void => {
	bridgeStarted = false
}
