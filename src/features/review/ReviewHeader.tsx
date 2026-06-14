import { BranchChip } from '@/features/projects/BranchChip'
import { pushToast } from '@/shared/toasts'
import { DiffStat, SDot } from '@/shared/ui/atoms'
import type { DiffLayout } from '@/shared/useLayoutToggle'

import type { DiffTotals } from './reviewFiles'

type Props = {
	repoPath: string | null
	totals: DiffTotals
	layout: DiffLayout
	toggleLayout: () => void
	onRequestChanges: () => void
}

/**
 * The review screen's top strip: status dot, branch, title, totals and the
 * actions cluster (diff style toggle, request changes, approve & merge).
 */
export const ReviewHeader = ({
	repoPath,
	totals,
	layout,
	toggleLayout,
	onRequestChanges,
}: Props): React.JSX.Element => (
	<header className="review__top">
		<SDot s="rev" />
		<BranchChip repoPath={repoPath} />
		{/* TODO: per-branch task name once tasks link to branches. */}
		<h2 className="review__title">Working tree review</h2>
		<DiffStat
			add={totals.additions}
			del={totals.deletions}
			files={totals.files}
		/>
		<div className="review__actions">
			<div
				className="review__view-seg"
				role="group"
				aria-label="Diff style"
			>
				<button
					type="button"
					aria-pressed={layout === 'split'}
					onClick={() => {
						if (layout !== 'split') toggleLayout()
					}}
				>
					Split
				</button>
				<button
					type="button"
					aria-pressed={layout === 'stacked'}
					onClick={() => {
						if (layout !== 'stacked') toggleLayout()
					}}
				>
					Unified
				</button>
			</div>
			<button
				type="button"
				className="btn btn-outline review__request"
				onClick={() => {
					onRequestChanges()
					pushToast('Describe the change you want from the agent')
				}}
			>
				Request changes
			</button>
			{/* TODO: wire to a review_merge Tauri command (approve + merge into main) — backend missing.
			    Once it exists: pushToast('Approved & merged into main') + navigate(missionControlHref()). */}
			<button
				type="button"
				className="btn btn-primary review__approve"
				disabled
				title="Merge backend not wired yet"
			>
				✓ Approve & merge
			</button>
		</div>
	</header>
)
