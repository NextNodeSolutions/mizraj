import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { useMemo, useRef, useState } from 'react'

import { useDiff } from '@/features/diff/useDiff'
import { BranchChip } from '@/features/projects/BranchChip'
import { pushToast } from '@/shared/toasts'
import { DiffStat, SDot } from '@/shared/ui/atoms'
import { useLayoutToggle } from '@/shared/useLayoutToggle'

import { ReviewDiffPane } from './ReviewDiffPane'
import { diffTotals, reviewFilesFromParsed } from './reviewFiles'
import { ReviewRail } from './ReviewRail'
import { ReviewTree } from './ReviewTree'

type Props = {
	activeProjectPath: string | null
}

type PlaceholderProps = {
	children: React.ReactNode
}

const ReviewPlaceholder = ({
	children,
}: PlaceholderProps): React.JSX.Element => (
	<section className="review review--empty" aria-label="Diff review">
		<p>{children}</p>
	</section>
)

const usePatchFiles = (patch: string | null): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch).flatMap(parsed => parsed.files),
		[patch],
	)

export const ReviewView = ({ activeProjectPath }: Props): React.JSX.Element => {
	const { state } = useDiff(activeProjectPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	const parsedFiles = usePatchFiles(patch)
	const files = useMemo(
		() => reviewFilesFromParsed(parsedFiles),
		[parsedFiles],
	)
	const [selectedPath, setSelectedPath] = useState<string | null>(null)
	const { layout, toggleLayout, diffStyle } = useLayoutToggle()
	const composeRef = useRef<HTMLTextAreaElement>(null)

	const selected =
		files.find(file => file.path === selectedPath) ?? files[0] ?? null
	const selectedMeta =
		parsedFiles.find(file => file.name === selected?.path) ?? null
	const totals = diffTotals(files)

	if (state.status === 'idle') {
		return <ReviewPlaceholder>No repository selected.</ReviewPlaceholder>
	}
	if (state.status === 'loading') {
		return <ReviewPlaceholder>Loading diff…</ReviewPlaceholder>
	}
	if (state.status === 'error') {
		return (
			<ReviewPlaceholder>
				Diff unavailable: {state.message}
			</ReviewPlaceholder>
		)
	}
	if (files.length === 0) {
		return (
			<ReviewPlaceholder>
				No changes — the working tree is clean.
			</ReviewPlaceholder>
		)
	}

	return (
		<section className="review" aria-label="Diff review">
			<header className="review__top">
				<SDot s="rev" />
				<BranchChip repoPath={activeProjectPath} />
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
							composeRef.current?.focus()
							pushToast(
								'Describe the change you want from the agent',
							)
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
			<div className="review__body stagger">
				<ReviewTree
					files={files}
					selectedPath={selected?.path ?? null}
					onSelect={setSelectedPath}
				/>
				{selected !== null && selectedMeta !== null ? (
					<ReviewDiffPane
						file={selected}
						meta={selectedMeta}
						diffStyle={diffStyle}
					/>
				) : (
					<section
						className="panel review__diff"
						aria-label="File diff"
					/>
				)}
				<ReviewRail
					repoPath={activeProjectPath}
					totals={totals}
					selectedPath={selected?.path ?? null}
					composeRef={composeRef}
				/>
			</div>
		</section>
	)
}
