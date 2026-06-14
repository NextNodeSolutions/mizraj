import { getDefaultStore } from 'jotai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import type { ReviewMessage } from './agentConversation'

const store = getDefaultStore()

// A probe that reads one repo's thread and serializes its message texts, so a
// test can assert what useConversation hands back for a given repoPath without
// a component file. Kept JSX-free (createElement) to keep this a .ts test.
const ThreadProbe = ({
	repoPath,
}: {
	repoPath: string | null
}): React.JSX.Element => {
	const thread = useConversation(repoPath)
	return createElement('output', null, thread.map(m => m.text).join('|'))
}

const message = (id: number, text: string): ReviewMessage => ({
	id,
	text,
	ref: null,
})

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
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(conversationsAtom, {
			'/repo-a': [message(1, 'a-one'), message(2, 'a-two')],
			'/repo-b': [message(1, 'b-one')],
		})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	const renderProbe = (repoPath: string | null): void => {
		act(() => {
			root.render(createElement(ThreadProbe, { repoPath }))
		})
	}

	it('hands each repo only its own thread', () => {
		renderProbe('/repo-a')
		expect(container.querySelector('output')?.textContent).toBe(
			'a-one|a-two',
		)

		renderProbe('/repo-b')
		expect(container.querySelector('output')?.textContent).toBe('b-one')
	})

	it('yields an empty thread for a null repo', () => {
		renderProbe(null)
		expect(container.querySelector('output')?.textContent).toBe('')
	})

	it('yields an empty thread for a repo with no conversation', () => {
		renderProbe('/repo-unknown')
		expect(container.querySelector('output')?.textContent).toBe('')
	})
})
