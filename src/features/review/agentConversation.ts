import { invoke } from '@tauri-apps/api/core'
import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/**
 * Where a remark anchors in the diff: a file, optionally narrowed to one
 * line of one side — the shape the diff pane needs to place annotations.
 */
export type ReviewRef = {
	path: string
	line: number | null
	side: 'additions' | 'deletions' | null
}

export type ReviewMessage = {
	id: number
	text: string
	/** The anchor the remark was sent from, when any. */
	ref: ReviewRef | null
}

/** Human form of a ref: `src/api/handler.ts · line 14`, or just the path. */
export const reviewRefLabel = (ref: ReviewRef): string =>
	ref.line === null ? ref.path : `${ref.path} · line ${ref.line}`

// The agent receives the anchor inline ("[src/api/handler.ts:14] …") since
// the pasted text is all the context it gets.
const refPrefix = (ref: ReviewRef | null): string => {
	if (ref === null) return ''
	return ref.line === null ? `[${ref.path}] ` : `[${ref.path}:${ref.line}] `
}

type ConversationsMap = Readonly<Record<string, ReadonlyArray<ReviewMessage>>>

// One thread per repo: the review conversation follows the project, not the
// session — a relaunched agent inherits the running discussion.
export const conversationsAtom = atom<ConversationsMap>({})

let nextMessageId = 0

type SendArgs = {
	sessionId: string
	repoPath: string
	text: string
	ref: ReviewRef | null
}

/**
 * Deliver a review remark to the agent's prompt: paste the text (bracketed
 * paste keeps it one block), then submit with Enter. Only a delivered
 * message joins the thread — a dead session records nothing and resolves
 * false so the composer can tell the user.
 */
export const sendToAgent = async ({
	sessionId,
	repoPath,
	text,
	ref,
}: SendArgs): Promise<boolean> => {
	try {
		await invoke('session_paste', {
			sessionId,
			text: `${refPrefix(ref)}${text}`,
		})
		await invoke('session_write', { sessionId, text: '\r' })
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`sendToAgent: delivery failed: ${message}`, {
			scope: 'review',
			details: { stack, sessionId },
		})
		return false
	}

	const store = getDefaultStore()
	nextMessageId += 1
	const conversations = store.get(conversationsAtom)
	store.set(conversationsAtom, {
		...conversations,
		[repoPath]: [
			...(conversations[repoPath] ?? []),
			{ id: nextMessageId, text, ref },
		],
	})
	return true
}

export const useConversation = (
	repoPath: string | null,
): ReadonlyArray<ReviewMessage> => {
	const threadAtom = useMemo(
		() =>
			atom(get =>
				repoPath === null
					? []
					: (get(conversationsAtom)[repoPath] ?? []),
			),
		[repoPath],
	)
	return useAtomValue(threadAtom)
}
