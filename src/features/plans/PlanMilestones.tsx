import type { MilestoneGroup, TrackGroup } from '@/features/tasks/tasks'

import type { MilestoneState } from './planProgress'
import { isTrackDone, milestoneState } from './planProgress'

const STATE_TAG_CLASS: Readonly<Record<MilestoneState, string>> = {
	done: 'tag tag-run',
	'in progress': 'tag tag-rev',
	todo: 'tag',
}

/**
 * Extend a doc meta line with what the milestones section will show below —
 * only meaningful when that section renders (plan docs, non-empty overview).
 */
export const appendOverviewCounts = (
	meta: string,
	milestones: ReadonlyArray<MilestoneGroup>,
): string => {
	if (milestones.length === 0) return meta
	const milestoneCount = milestones.length
	const trackCount = milestones.reduce(
		(sum, milestone) => sum + milestone.tracks.length,
		0,
	)
	const milestoneLabel = `${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'}`
	const trackLabel = `${trackCount} track${trackCount === 1 ? '' : 's'}`
	return `${meta} · ${milestoneLabel} · ${trackLabel}`
}

const STAGGER_STEP_S = 0.045

type CheckProps = {
	done: boolean
}

const ProgressCheck = ({ done }: CheckProps): React.JSX.Element => (
	<span className="pl-check" data-done={done}>
		{done ? '✓' : null}
	</span>
)

type TrackRowProps = {
	track: TrackGroup
}

const TrackRow = ({ track }: TrackRowProps): React.JSX.Element => (
	<div className="pl-track">
		<ProgressCheck done={isTrackDone(track)} />
		<span className="tk">{track.id}</span>
		<span className="branch">{track.branch}</span>
	</div>
)

type CardProps = {
	milestone: MilestoneGroup
	index: number
}

const MilestoneCard = ({ milestone, index }: CardProps): React.JSX.Element => {
	const state = milestoneState(milestone)
	return (
		<div
			className="pl-milestone"
			style={{
				animationDelay: `calc(${index * STAGGER_STEP_S}s / var(--mspd))`,
			}}
		>
			<div className="mh">
				<ProgressCheck done={state === 'done'} />
				<b>{`M${milestone.number} · ${milestone.demo}`}</b>
				<span className={STATE_TAG_CLASS[state]}>{state}</span>
			</div>
			<div className="pl-tracks">
				{milestone.tracks.map(track => (
					<TrackRow key={track.id} track={track} />
				))}
			</div>
		</div>
	)
}

type Props = {
	milestones: ReadonlyArray<MilestoneGroup>
}

/**
 * The plan's delivery map: one card per milestone, its tracks as rows, all
 * states derived from the task tree. Omitted entirely while the project has
 * no ingested plan.
 */
export const PlanMilestones = ({
	milestones,
}: Props): React.JSX.Element | null => {
	if (milestones.length === 0) return null
	return (
		<>
			<h3 className="pl-h3">Milestones</h3>
			<div className="stagger">
				{milestones.map((milestone, index) => (
					<MilestoneCard
						key={milestone.id}
						milestone={milestone}
						index={index}
					/>
				))}
			</div>
		</>
	)
}
