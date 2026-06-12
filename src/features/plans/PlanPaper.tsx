import { navigate, pipelineHref } from '@/app/router'
import type { MilestoneGroup } from '@/features/tasks/tasks'
import { useTasks } from '@/features/tasks/tasks'

import { LaunchPlanAgentsButton } from './LaunchPlanAgentsButton'
import type { PlanDoc } from './planDoc'
import { appendOverviewCounts } from './planDoc'
import { PlanMilestones } from './PlanMilestones'
import { PlanPanel } from './PlanPanel'
import type { PlanKind } from './plans'

const KIND_TAG_CLASS: Readonly<Record<PlanKind, string>> = {
	plan: 'tag tag-rev',
	interview: 'tag tag-acc',
}

type Props = {
	doc: PlanDoc
	repoPath: string | null
}

/**
 * The document paper: head (title + kind tag), mono meta line, the framed
 * plan:// viewer and — for plan docs — the milestones derived from the task
 * overview. Mounted keyed by kind/slug so switching docs replays the stagger.
 */
// TODO: native intro/Q&A rendering needs structured plan/interview data; today the doc body is the plan:// iframe
export const PlanPaper = ({ doc, repoPath }: Props): React.JSX.Element => {
	// TODO: no plan->milestones linkage in backend; tasks_overview is per-project, shown for the active project regardless of which plan doc is open
	const tasks = useTasks(repoPath)
	const milestones: ReadonlyArray<MilestoneGroup> =
		doc.kind === 'plan' && tasks.state.status === 'ready'
			? tasks.state.data.milestones
			: []
	return (
		<div className="pl-doc">
			<div className="pl-paper stagger">
				<div className="pl-doc-head">
					<h1>{doc.title}</h1>
					<span className={KIND_TAG_CLASS[doc.kind]}>{doc.kind}</span>
				</div>
				<p className="pl-doc-meta">
					{appendOverviewCounts(doc.meta, milestones)}
				</p>
				<PlanPanel src={doc.url} title={`${doc.kind}/${doc.slug}`} />
				<PlanMilestones milestones={milestones} />
				{doc.kind === 'plan' && (
					<div className="pl-actions">
						<LaunchPlanAgentsButton
							repoPath={repoPath}
							milestones={milestones}
						/>
						<button
							type="button"
							className="btn btn-outline"
							onClick={() => navigate(pipelineHref())}
						>
							Open in Pipeline
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
