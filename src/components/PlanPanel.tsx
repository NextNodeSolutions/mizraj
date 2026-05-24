import { useState } from 'react'

type Props = {
	src: string
	title?: string
}

type Status = 'loading' | 'ready' | 'error'

const PlanPanel = ({ src, title }: Props): React.JSX.Element => {
	const [status, setStatus] = useState<Status>('loading')
	return (
		<div className="plan-panel__container">
			<iframe
				className="plan-panel"
				src={src}
				title={title ?? 'Plan'}
				onLoad={() => setStatus('ready')}
				onError={() => setStatus('error')}
				// oxlint-disable-next-line react/iframe-missing-sandbox -- self-contained docs HTML served from plan:// needs its own JS and same-origin access; trusted local content
				sandbox="allow-scripts allow-same-origin"
			/>
			{status === 'loading' && (
				<p
					className="plan-panel__placeholder"
					role="status"
					aria-live="polite"
				>
					Loading plan…
				</p>
			)}
			{status === 'error' && (
				<p
					className="plan-panel__placeholder plan-panel__placeholder--error"
					role="alert"
				>
					Failed to load plan.
				</p>
			)}
		</div>
	)
}

export default PlanPanel
