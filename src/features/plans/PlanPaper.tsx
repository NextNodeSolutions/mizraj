import { navigate, pipelineHref, planRouteHref } from '@/app/router'
import type { MilestoneGroup } from '@/features/tasks/tasks'

import { LaunchPlanAgentsButton } from './LaunchPlanAgentsButton'
import type { PlanDoc } from './planDoc'
import { appendOverviewCounts, PlanMilestones } from './PlanMilestones'
import { PlanPanel } from './PlanPanel'
import type { PlanEntry, PlanKind } from './plans'

const KIND_TAG_CLASS: Readonly<Record<PlanKind, string>> = {
	plan: 'tag tag-rev',
	interview: 'tag tag-acc',
}

type Props = {
	doc: PlanDoc
	/** Milestones for the doc, derived by the caller (empty for interviews). */
	milestones: ReadonlyArray<MilestoneGroup>
	/** The plan an interview produced, when one is listed; else null. */
	generatedPlan: PlanEntry | null
	repoPath: string | null
}

/**
 * The document paper: head (title + kind tag), mono meta line, the framed
 * plan:// viewer and — for plan docs — the milestones section. Purely
 * presentational: the caller (PlanView) derives milestones and the generated
 * plan. Mounted keyed by kind/slug so switching docs replays the stagger.
 */
// TODO: native intro/Q&A rendering needs structured plan/interview data; today the doc body is the plan:// iframe
export const PlanPaper = ({
	doc,
	milestones,
	generatedPlan,
	repoPath,
}: Props): React.JSX.Element => (
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
			{generatedPlan !== null && (
				<div className="pl-actions">
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => navigate(planRouteHref(generatedPlan))}
					>
						→ Open generated plan
					</button>
				</div>
			)}
		</div>
	</div>
)
