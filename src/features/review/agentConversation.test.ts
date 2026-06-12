import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import {
	conversationsAtom,
	sendToAgent,
	useConversation,
} from './agentConversation'

const store = getDefaultStore()

describe('sendToAgent', () => {
	beforeEach(() => {
		store.set(conversationsAtom, {})
		invokeMock.mockReset()
		invokeMock.mockResolvedValue(undefined)
	})

	it('pastes the message into the session then submits it', async () => {
		const sent = await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'gère aussi le cas null',
			ref: 'src/api/handler.ts',
		})

		expect(sent).toBe(true)
		expect(invokeMock).toHaveBeenNthCalledWith(1, 'session_paste', {
			sessionId: 'sess-1',
			text: 'gère aussi le cas null',
		})
		expect(invokeMock).toHaveBeenNthCalledWith(2, 'session_write', {
			sessionId: 'sess-1',
			text: '\r',
		})
	})

	it('records the message in the repo conversation with its file ref', async () => {
		await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'hello',
			ref: 'src/a.ts',
		})

		const thread = store.get(conversationsAtom)['/repo']
		expect(thread?.map(m => ({ text: m.text, ref: m.ref }))).toEqual([
			{ text: 'hello', ref: 'src/a.ts' },
		])
	})

	it('reports failure and records nothing when the session rejects input', async () => {
		invokeMock.mockRejectedValue(new Error('gone'))

		const sent = await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'hello',
			ref: null,
		})

		expect(sent).toBe(false)
		expect(store.get(conversationsAtom)['/repo']).toBeUndefined()
	})
})

describe('useConversation', () => {
	it('is exported for components', () => {
		expect(typeof useConversation).toBe('function')
	})
})
