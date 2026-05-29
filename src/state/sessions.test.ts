import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listenMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock,
}))

import {
	AGENT_OUTPUT_EVENT,
	resetAgentEventsBridgeForTests,
	appendOutputAtom,
	endSessionAtom,
	sessionsAtom,
	startAgentEventsBridge,
	startSessionAtom,
} from './sessions'
import type { AgentOutputPayload } from './sessions'

const store = getDefaultStore()

describe('sessions atoms', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
	})

	it('startSessionAtom registers a fresh session with empty output and running status', () => {
		store.set(startSessionAtom, 'sess-a')

		expect(store.get(sessionsAtom)['sess-a']).toEqual({
			id: 'sess-a',
			output: [],
			status: 'running',
			exitCode: null,
		})
	})

	it('appendOutputAtom pushes chunks in order onto the matching session', () => {
		store.set(startSessionAtom, 'sess-a')
		store.set(appendOutputAtom, {
			sessionId: 'sess-a',
			chunk: { kind: 'stdout', text: 'hello ' },
		})
		store.set(appendOutputAtom, {
			sessionId: 'sess-a',
			chunk: { kind: 'stdout', text: 'world' },
		})

		expect(store.get(sessionsAtom)['sess-a']?.output).toEqual([
			{ kind: 'stdout', text: 'hello ' },
			{ kind: 'stdout', text: 'world' },
		])
	})

	it('appendOutputAtom is a no-op when the session is unknown', () => {
		const before = store.get(sessionsAtom)
		store.set(appendOutputAtom, {
			sessionId: 'ghost',
			chunk: { kind: 'stdout', text: 'x' },
		})

		expect(store.get(sessionsAtom)).toBe(before)
	})

	it('endSessionAtom flips status to ended and stores the exit code', () => {
		store.set(startSessionAtom, 'sess-a')
		store.set(endSessionAtom, { sessionId: 'sess-a', exitCode: 0 })

		const session = store.get(sessionsAtom)['sess-a']
		expect(session?.status).toBe('ended')
		expect(session?.exitCode).toBe(0)
	})

	it('subscribers are notified on every atom write', () => {
		const seen: Array<Readonly<Record<string, unknown>>> = []
		const unsubscribe = store.sub(sessionsAtom, () => {
			seen.push(store.get(sessionsAtom))
		})

		store.set(startSessionAtom, 'sess-a')
		store.set(appendOutputAtom, {
			sessionId: 'sess-a',
			chunk: { kind: 'stdout', text: 'hi' },
		})

		unsubscribe()
		expect(seen).toHaveLength(2)
		expect(seen[0]).not.toBe(seen[1])
	})
})

describe('startAgentEventsBridge', () => {
	const unlistenMock = vi.fn()

	beforeEach(() => {
		resetAgentEventsBridgeForTests()
		store.set(sessionsAtom, {})
		listenMock.mockReset()
		unlistenMock.mockReset()
		listenMock.mockResolvedValue(unlistenMock)
	})

	const getCapturedHandler = (): ((event: {
		payload: AgentOutputPayload
	}) => void) => {
		const call = listenMock.mock.calls[0]
		if (!call) throw new Error('listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('listen() handler was not a function')
		}
		return handler
	}

	it('subscribes to agent:output exactly once', () => {
		startAgentEventsBridge()
		startAgentEventsBridge()
		startAgentEventsBridge()

		expect(listenMock).toHaveBeenCalledTimes(1)
		expect(listenMock).toHaveBeenCalledWith(
			AGENT_OUTPUT_EVENT,
			expect.any(Function),
		)
	})

	it('routes each agent:output payload into the matching session', () => {
		startAgentEventsBridge()
		const handler = getCapturedHandler()

		store.set(startSessionAtom, 'sess-a')
		handler({
			payload: { session_id: 'sess-a', kind: 'stderr', text: 'boom' },
		})

		expect(store.get(sessionsAtom)['sess-a']?.output).toEqual([
			{ kind: 'stderr', text: 'boom' },
		])
	})
})
