type Props = {
	src: string
	title?: string
}

const PlanPanel = ({ src, title }: Props): React.JSX.Element => (
	<iframe
		className="plan-panel"
		src={src}
		title={title ?? 'Plan'}
		// oxlint-disable-next-line react/iframe-missing-sandbox -- D18: self-contained docs HTML loaded from asset:// needs its own JS and same-origin access; trusted local content
		sandbox="allow-scripts allow-same-origin"
	/>
)

export default PlanPanel
