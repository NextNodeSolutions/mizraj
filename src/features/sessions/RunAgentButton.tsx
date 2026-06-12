import { useState } from 'react'

import { launchSession } from './launchSession'

type Props = {
	repoPath: string
	binary?: string
}

const DEFAULT_BINARY = 'claude'

export const RunAgentButton = ({
	repoPath,
	binary = DEFAULT_BINARY,
}: Props): React.JSX.Element => {
	const [pending, setPending] = useState(false)

	const handleClick = (): void => {
		setPending(true)
		void launchSession({ binary, repoPath }).finally(() => {
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
