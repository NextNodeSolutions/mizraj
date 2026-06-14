import { invoke } from '@tauri-apps/api/core'
import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/**
 * Where a remark anchors in the diff: a whole file, or one line of one side.
 * The two cases are coupled — a line anchor always carries the side it lives
 * on, a file anchor carries neither — so consumers never face a line without
 * its side (no `?? 'additions'` guesswork at the annotation boundary).
 */
export type ReviewRef =
	| { path: string; line: null; side: null }
	| { path: string; line: number; side: 'additions' | 'deletions' }

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

// The next id for a thread: one past its highest existing id (0 when empty).
// Derived from the thread inside the store updater so the id stays a pure
// function of state, never a module-global counter that two windows could
// race or a test could leave dirty across runs.
const nextMessageId = (thread: ReadonlyArray<ReviewMessage>): number =>
	thread.reduce((max, message) => Math.max(max, message.id), 0) + 1

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
	store.set(conversationsAtom, conversations => {
		const thread = conversations[repoPath] ?? []
		return {
			...conversations,
			[repoPath]: [...thread, { id: nextMessageId(thread), text, ref }],
		}
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
