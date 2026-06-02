import type { ReactNode } from 'react'

type Tone = 'loading' | 'empty' | 'error'

type Props = {
	tone: Tone
	children: ReactNode
}

export const DiffPanelPlaceholder = ({
	tone,
	children,
}: Props): React.JSX.Element => {
	if (tone === 'loading') {
		return (
			<p
				className="diff-panel__placeholder"
				role="status"
				aria-live="polite"
			>
				{children}
			</p>
		)
	}
	if (tone === 'error') {
		return (
			<p
				className="diff-panel__placeholder diff-panel__placeholder--error"
				role="alert"
			>
				{children}
			</p>
		)
	}
	return (
		<p className="diff-panel__placeholder" role="status">
			{children}
		</p>
	)
}
