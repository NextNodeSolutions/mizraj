import { invoke } from '@tauri-apps/api/core'
import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

export type ReviewMessage = {
	id: number
	text: string
	/** The file the remark anchors to, when sent from a file's diff. */
	ref: string | null
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
	ref: string | null
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
		await invoke('session_paste', { sessionId, text })
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
