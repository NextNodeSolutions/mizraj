import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'
import { navigate } from '../router'

type Props = {
	repoPath: string
}

const agentRunHref = (sessionId: string): string => `/agent-run/${sessionId}`

const RunAgentButton = ({ repoPath }: Props): React.JSX.Element => {
	const [pending, setPending] = useState(false)

	const handleClick = (): void => {
		setPending(true)
		invoke<string>('run_agent', { repoPath })
			.then(sessionId => {
				navigate(agentRunHref(sessionId))
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`RunAgentButton: run_agent failed: ${message}`, {
					scope: 'run-agent',
					details: { stack, repoPath },
				})
			})
			.finally(() => {
				setPending(false)
			})
	}

	return (
		<button
			type="button"
			className="run-agent-button"
			onClick={handleClick}
			disabled={pending}
			aria-busy={pending}
		>
			{pending ? 'Starting…' : 'Run agent'}
		</button>
	)
}

export default RunAgentButton
