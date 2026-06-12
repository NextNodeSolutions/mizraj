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
	reviewRefLabel,
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

	it('pastes the message prefixed with its file anchor then submits it', async () => {
		const sent = await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'gère aussi le cas null',
			ref: { path: 'src/api/handler.ts', line: null, side: null },
		})

		expect(sent).toBe(true)
		expect(invokeMock).toHaveBeenNthCalledWith(1, 'session_paste', {
			sessionId: 'sess-1',
			text: '[src/api/handler.ts] gère aussi le cas null',
		})
		expect(invokeMock).toHaveBeenNthCalledWith(2, 'session_write', {
			sessionId: 'sess-1',
			text: '\r',
		})
	})

	it('records the raw message in the repo conversation with its structured ref', async () => {
		await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'hello',
			ref: { path: 'src/a.ts', line: null, side: null },
		})

		const thread = store.get(conversationsAtom)['/repo']
		expect(thread?.map(m => ({ text: m.text, ref: m.ref }))).toEqual([
			{
				text: 'hello',
				ref: { path: 'src/a.ts', line: null, side: null },
			},
		])
	})

	it('anchors a line comment as [path:line] in the pasted text', async () => {
		await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'handle the null case too',
			ref: { path: 'src/api/handler.ts', line: 14, side: 'additions' },
		})

		expect(invokeMock).toHaveBeenNthCalledWith(1, 'session_paste', {
			sessionId: 'sess-1',
			text: '[src/api/handler.ts:14] handle the null case too',
		})
	})

	it('pastes an unanchored message verbatim', async () => {
		await sendToAgent({
			sessionId: 'sess-1',
			repoPath: '/repo',
			text: 'run the tests again',
			ref: null,
		})

		expect(invokeMock).toHaveBeenNthCalledWith(1, 'session_paste', {
			sessionId: 'sess-1',
			text: 'run the tests again',
		})
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

describe('reviewRefLabel', () => {
	it('shows path and line for a line-anchored ref', () => {
		expect(
			reviewRefLabel({
				path: 'src/api/handler.ts',
				line: 14,
				side: 'additions',
			}),
		).toBe('src/api/handler.ts · line 14')
	})

	it('shows the path alone for a file-level ref', () => {
		expect(
			reviewRefLabel({
				path: 'src/api/handler.ts',
				line: null,
				side: null,
			}),
		).toBe('src/api/handler.ts')
	})
})

describe('useConversation', () => {
	it('is exported for components', () => {
		expect(typeof useConversation).toBe('function')
	})
})
