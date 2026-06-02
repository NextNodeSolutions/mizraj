import { MilestoneSection } from './MilestoneSection'
import type { MilestoneGroup } from './tasks'

type PlanTreeProps = {
	milestones: ReadonlyArray<MilestoneGroup>
	onChanged: () => void
}

export const PlanTree = ({
	milestones,
	onChanged,
}: PlanTreeProps): React.JSX.Element => {
	if (milestones.length === 0) {
		return (
			<p className="tasks-view__empty">
				No plan ingested for this project yet.
			</p>
		)
	}
	return (
		<div className="tasks-tree" aria-label="Plan">
			{milestones.map(milestone => (
				<MilestoneSection
					key={milestone.id}
					milestone={milestone}
					onChanged={onChanged}
				/>
			))}
		</div>
	)
}
