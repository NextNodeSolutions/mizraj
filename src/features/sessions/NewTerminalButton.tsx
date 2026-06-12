import { useState } from 'react'

import { launchShellSession } from './launchSession'

type Props = {
	repoPath: string
}

// A plain terminal in the active project: the user's default shell, no agent.
export const NewTerminalButton = ({ repoPath }: Props): React.JSX.Element => {
	const [pending, setPending] = useState(false)

	const handleClick = (): void => {
		setPending(true)
		void launchShellSession(repoPath).finally(() => {
			setPending(false)
		})
	}

	return (
		<button
			type="button"
			className="new-terminal-button"
			onClick={handleClick}
			disabled={pending}
			aria-busy={pending}
		>
			{pending ? 'Opening…' : 'New terminal'}
		</button>
	)
}
