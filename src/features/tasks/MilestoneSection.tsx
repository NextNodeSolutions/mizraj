import type { MilestoneGroup } from './tasks'
import { TrackSection } from './TrackSection'

type MilestoneSectionProps = {
	milestone: MilestoneGroup
	onChanged: () => void
}

export const MilestoneSection = ({
	milestone,
	onChanged,
}: MilestoneSectionProps): React.JSX.Element => {
	const { id, demo, skeleton, needs, tracks } = milestone
	const hasNeeds = needs.length > 0
	return (
		<section className="tasks-tree__milestone">
			<header className="tasks-tree__milestone-header">
				<span className="tasks-tree__milestone-id">{id}</span>
				<span className="tasks-tree__milestone-demo">{demo}</span>
				{skeleton && (
					<span className="tasks-tree__badge">skeleton</span>
				)}
				{hasNeeds && (
					<span className="tasks-tree__needs">
						needs: {needs.join(', ')}
					</span>
				)}
			</header>
			{tracks.map(track => (
				<TrackSection
					key={track.id}
					track={track}
					onChanged={onChanged}
				/>
			))}
		</section>
	)
}
