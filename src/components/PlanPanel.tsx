import { useState } from 'react'

type Props = {
	src: string
	title?: string
}

const PlanPanel = ({ src, title }: Props): React.JSX.Element => {
	const [loaded, setLoaded] = useState(false)
	return (
		<div className="plan-panel__container">
			<iframe
				className="plan-panel"
				src={src}
				title={title ?? 'Plan'}
				onLoad={() => setLoaded(true)}
				// oxlint-disable-next-line react/iframe-missing-sandbox -- self-contained docs HTML served from plan:// needs its own JS and same-origin access; trusted local content
				sandbox="allow-scripts allow-same-origin"
			/>
			{!loaded && (
				<p
					className="plan-panel__placeholder"
					role="status"
					aria-live="polite"
				>
					Loading plan…
				</p>
			)}
		</div>
	)
}

export default PlanPanel
