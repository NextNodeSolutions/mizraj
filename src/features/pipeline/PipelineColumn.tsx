import { SDot } from '@/shared/ui/atoms'
import type { SDotKind } from '@/shared/ui/atoms'

/** Entrance stagger step between two columns (multiplied by `si`). */
const STAGGER_STEP_MS = 45

type Props = {
	title: string
	count: number
	dot: SDotKind
	/** Stagger index 0..3, left to right — drives the entrance delay. */
	si: number
	children: React.ReactNode
}

export const PipelineColumn = ({
	title,
	count,
	dot,
	si,
	children,
}: Props): React.JSX.Element => (
	<div
		className="pipeline__col"
		style={{ animationDelay: `${si * STAGGER_STEP_MS}ms` }}
	>
		<div className="pipeline__col-head">
			<SDot s={dot} />
			<h3>{title}</h3>
			<span className="pipeline__count">{count}</span>
		</div>
		<div className="pipeline__cards">{children}</div>
	</div>
)
