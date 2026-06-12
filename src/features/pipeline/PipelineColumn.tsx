type Props = {
	title: string
	count: number
	status?: 'running' | 'review' | 'failed'
	children: React.ReactNode
}

export const PipelineColumn = ({
	title,
	count,
	status,
	children,
}: Props): React.JSX.Element => (
	<div className="pipeline__col">
		<div className="pipeline__col-head">
			<span className="status-dot" data-status={status} />
			<h3>{title}</h3>
			<span className="pipeline__count">{count}</span>
		</div>
		<div className="pipeline__cards">{children}</div>
	</div>
)
