import type { TrackGroup } from './tasks'
import { TrackTaskRow } from './TrackTaskRow'

type TrackSectionProps = {
	track: TrackGroup
	onChanged: () => void
}

export const TrackSection = ({
	track,
	onChanged,
}: TrackSectionProps): React.JSX.Element => (
	<section className="tasks-tree__track">
		<header className="tasks-tree__track-header">
			<span className="tasks-tree__track-id">{track.id}</span>
			<span className="tasks-tree__track-branch">{track.branch}</span>
		</header>
		<ul className="tasks-view__list">
			{track.tasks.map(task => (
				<TrackTaskRow key={task.id} task={task} onChanged={onChanged} />
			))}
		</ul>
	</section>
)
