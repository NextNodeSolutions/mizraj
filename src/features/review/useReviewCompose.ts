import { useState } from 'react'

import type { SessionState } from '@/features/sessions/sessions'
import { terminalTail } from '@/features/sessions/terminalTail'
import { useCellFrame } from '@/features/sessions/useCellFrame'
import { useSessions } from '@/features/sessions/useSessions'
import { pushToast } from '@/shared/toasts'

import type { ReviewRef } from './agentConversation'
import { sendToAgent } from './agentConversation'
import { pickAgentSession } from './pickAgentSession'

type ReviewCompose = {
	draft: string
	setDraft: (value: string) => void
	sending: boolean
	/** The agent session a remark lands in, or null if none runs in the repo. */
	target: SessionState | null
	/** The agent's latest output line, when its frame is cached. */
	tailLine: string | undefined
	submit: () => void
}

/**
 * The review composer's send workflow: pick the repo's agent session, track the
 * draft + in-flight flag, deliver the remark and report the outcome via toast.
 * Lifted out of ReviewRail so the rail only renders.
 */
export const useReviewCompose = (
	repoPath: string | null,
	context: ReviewRef | null,
): ReviewCompose => {
	const sessions = useSessions()
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const target = pickAgentSession(sessions, repoPath)
	// What the agent is showing right now — only when its frame is cached
	// (the session was subscribed at least once); absent otherwise.
	const targetFrame = useCellFrame(target?.id ?? '')
	const [tailLine] = terminalTail(targetFrame, 1)

	const submit = (): void => {
		const text = draft.trim()
		if (text === '' || target === null || repoPath === null) return
		setSending(true)
		void sendToAgent({ sessionId: target.id, repoPath, text, ref: context })
			.then(sent => {
				if (!sent) {
					pushToast('Delivery failed — is the agent still running?')
					return
				}
				setDraft('')
				pushToast('Sent to agent ↻')
			})
			.finally(() => setSending(false))
	}

	return { draft, setDraft, sending, target, tailLine, submit }
}
