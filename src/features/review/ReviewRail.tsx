import { useState } from 'react'

import { useSessions } from '@/features/sessions/useSessions'
import { pushToast } from '@/shared/toasts'

import { sendToAgent, useConversation } from './agentConversation'
import { pickAgentSession } from './pickAgentSession'
import type { DiffTotals } from './reviewFiles'

type Props = {
	repoPath: string | null
	totals: DiffTotals
	selectedPath: string | null
	composeRef: React.Ref<HTMLTextAreaElement>
}

export const ReviewRail = ({
	repoPath,
	totals,
	selectedPath,
	composeRef,
}: Props): React.JSX.Element => {
	const sessions = useSessions()
	const thread = useConversation(repoPath)
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const target = pickAgentSession(sessions, repoPath)

	const submit = (): void => {
		const text = draft.trim()
		if (text === '' || target === null || repoPath === null) return
		setSending(true)
		void sendToAgent({
			sessionId: target.id,
			repoPath,
			text,
			ref: selectedPath,
		})
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

	return (
		<aside className="review-rail" aria-label="Review conversation">
			<div className="review-rail__summary">
				<h4>Working tree</h4>
				<p>
					{totals.files} files ·{' '}
					<span className="diff-add">+{totals.additions}</span>{' '}
					<span className="diff-del">−{totals.deletions}</span>
				</p>
			</div>
			<div className="review-rail__thread">
				<h4>Conversation</h4>
				{thread.length === 0 ? (
					<p className="review-rail__hint">
						Review is a conversation — ask the agent to iterate.
					</p>
				) : (
					<ul>
						{thread.map(message => (
							<li key={message.id} className="review-rail__msg">
								{message.ref !== null && (
									<span className="review-rail__ref">
										↳ {message.ref}
									</span>
								)}
								<span>{message.text}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="review-rail__compose">
				{target === null && (
					<p className="review-rail__hint">
						No running agent in this repo — launch one to iterate.
					</p>
				)}
				<textarea
					ref={composeRef}
					value={draft}
					disabled={target === null || sending}
					placeholder="Ask the agent for a change…"
					onChange={event => setDraft(event.target.value)}
				/>
				<div className="review-rail__compose-row">
					{selectedPath !== null && (
						<span className="review-rail__ref">
							↳ {selectedPath}
						</span>
					)}
					<button
						type="button"
						className="review-rail__send"
						disabled={
							target === null || sending || draft.trim() === ''
						}
						onClick={submit}
					>
						Send to agent ↑
					</button>
				</div>
			</div>
		</aside>
	)
}
