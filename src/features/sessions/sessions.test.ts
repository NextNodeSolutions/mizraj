import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listenMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock,
}))

import {
	resetAgentEventsBridgeForTests,
	startAgentEventsBridge,
} from './agentEventsBridge'
import {
	AGENT_CELLS_EVENT,
	AGENT_END_EVENT,
	AGENT_TITLE_EVENT,
	cellFramesAtom,
	endSessionAtom,
	sessionsAtom,
	startSessionAtom,
} from './sessions'
import type { SessionEndPayload } from './sessions'
import type { CellFramePayload } from './terminalWire'

const store = getDefaultStore()

describe('sessions atoms', () => {
	beforeEach(() => {
		store.set(sessionsAtom, {})
	})

	it('startSessionAtom registers a fresh running session', () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_750_000_000_000)

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})

		expect(store.get(sessionsAtom)['sess-a']).toEqual({
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
			title: null,
			status: 'running',
			exitCode: null,
			startedAt: 1_750_000_000_000,
		})
		vi.useRealTimers()
	})

	it('endSessionAtom flips status to ended and stores the exit code', () => {
		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
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

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(endSessionAtom, { sessionId: 'sess-a', exitCode: 0 })

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
		store.set(cellFramesAtom, {})
		listenMock.mockReset()
		unlistenMock.mockReset()
		listenMock.mockResolvedValue(unlistenMock)
	})

	it('subscribes to agent:end, agent:cells and agent:title exactly once each', () => {
		startAgentEventsBridge()
		startAgentEventsBridge()
		startAgentEventsBridge()

		expect(listenMock).toHaveBeenCalledTimes(3)
		expect(listenMock).toHaveBeenNthCalledWith(
			1,
			AGENT_END_EVENT,
			expect.any(Function),
		)
		expect(listenMock).toHaveBeenNthCalledWith(
			2,
			AGENT_CELLS_EVENT,
			expect.any(Function),
		)
		expect(listenMock).toHaveBeenNthCalledWith(
			3,
			AGENT_TITLE_EVENT,
			expect.any(Function),
		)
	})

	const getCapturedEndHandler = (): ((event: {
		payload: SessionEndPayload
	}) => void) => {
		const call = listenMock.mock.calls[0]
		if (!call) throw new Error('agent:end listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('agent:end listen() handler was not a function')
		}
		return handler
	}

	it('routes agent:end into endSessionAtom for a known session', () => {
		startAgentEventsBridge()
		const handler = getCapturedEndHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		handler({ payload: { session_id: 'sess-a', exit_code: 0 } })

		const session = store.get(sessionsAtom)['sess-a']
		expect(session?.status).toBe('ended')
		expect(session?.exitCode).toBe(0)
	})

	const getCapturedCellsHandler = (): ((event: {
		payload: CellFramePayload
	}) => void) => {
		const call = listenMock.mock.calls[1]
		if (!call) throw new Error('agent:cells listen() was not called')
		const handler = call[1]
		if (typeof handler !== 'function') {
			throw new Error('agent:cells listen() handler was not a function')
		}
		return handler
	}

	it('routes agent:cells into cellFramesAtom for a known session', () => {
		startAgentEventsBridge()
		const handler = getCapturedCellsHandler()

		store.set(startSessionAtom, {
			id: 'sess-a',
			binary: 'claude',
			repoPath: '/repo',
		})
		const frame: CellFramePayload = {
			session_id: 'sess-a',
			cols: 2,
			rows: 1,
			cells: [],
			cursor: null,
			mouse_reporting: false,
			viewport_top: 0,
			history_total: 0,
		}
		handler({ payload: frame })

		expect(store.get(cellFramesAtom)['sess-a']).toBe(frame)
	})

	it('drops agent:cells for an unknown session', () => {
		startAgentEventsBridge()
		const handler = getCapturedCellsHandler()

		const before = store.get(cellFramesAtom)
		handler({
			payload: {
				session_id: 'ghost',
				cols: 1,
				rows: 1,
				cells: [],
				cursor: null,
				mouse_reporting: false,
				viewport_top: 0,
				history_total: 0,
			},
		})

		expect(store.get(cellFramesAtom)).toBe(before)
	})
})
