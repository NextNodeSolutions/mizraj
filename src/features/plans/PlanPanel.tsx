import { useEffect, useState } from 'react'

type Props = {
	src: string
	title?: string
}

type LoadStatus = 'loading' | 'loaded' | 'timeout'

const LOAD_TIMEOUT_MS = 5000

export const PlanPanel = ({ src, title }: Props): React.JSX.Element => {
	const [status, setStatus] = useState<LoadStatus>('loading')

	useEffect(() => {
		setStatus('loading')
		const timer = window.setTimeout(() => {
			setStatus(current => (current === 'loading' ? 'timeout' : current))
		}, LOAD_TIMEOUT_MS)
		return () => window.clearTimeout(timer)
	}, [src])

	return (
		<div className="plan-panel__container">
			<iframe
				className="plan-panel"
				src={src}
				title={title ?? 'Plan'}
				onLoad={() => setStatus('loaded')}
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
			{status === 'timeout' && (
				<p
					className="plan-panel__placeholder plan-panel__placeholder--error"
					role="alert"
					aria-live="assertive"
				>
					Plan did not load. Check that the file exists and the
					project path is set.
				</p>
			)}
		</div>
	)
}
