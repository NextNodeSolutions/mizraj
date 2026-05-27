import { invoke } from '@tauri-apps/api/core'
import { useSetAtom } from 'jotai'
import { useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'
import { navigate } from '../router'
import { startSessionAtom } from '../state/sessions'

type Props = {
	repoPath: string
	binary?: string
}

const DEFAULT_BINARY = 'claude'

const agentRunHref = (sessionId: string): string => `/agent-run/${sessionId}`

const RunAgentButton = ({
	repoPath,
	binary = DEFAULT_BINARY,
}: Props): React.JSX.Element => {
	const [pending, setPending] = useState(false)
	const registerSession = useSetAtom(startSessionAtom)

	const handleClick = (): void => {
		setPending(true)
		invoke<string>('session_create', { binary, cwd: repoPath })
			.then(sessionId => {
				registerSession(sessionId)
				navigate(agentRunHref(sessionId))
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(
					`RunAgentButton: session_create failed: ${message}`,
					{
						scope: 'run-agent',
						details: { stack, repoPath, binary },
					},
				)
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
