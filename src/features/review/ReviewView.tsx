import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useMemo, useRef, useState } from 'react'

import { useDiff } from '@/features/diff/useDiff'
import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'
import { useLayoutToggle } from '@/shared/useLayoutToggle'

import { ReviewRail } from './ReviewRail'
import { ReviewTree } from './ReviewTree'
import { diffTotals, reviewFilesFromParsed } from './reviewFiles'

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

const usePatchFiles = (
	patch: string | null,
): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch).flatMap(parsed => parsed.files),
		[patch],
	)

export const ReviewView = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
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
				<span className="status-dot" data-status="review" />
				<h2>Working tree review</h2>
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
						className="review__request"
						onClick={() => composeRef.current?.focus()}
					>
						Request changes
					</button>
				</div>
			</header>
			<div className="review__body">
				<ReviewTree
					files={files}
					selectedPath={selected?.path ?? null}
					onSelect={setSelectedPath}
				/>
				<div className="review__diff">
					{selectedMeta !== null && (
						<FileDiff
							key={selectedMeta.name}
							fileDiff={selectedMeta}
							options={{
								diffStyle,
								theme: NEXTNODE_DIFF_THEME,
							}}
						/>
					)}
				</div>
				<ReviewRail
					repoPath={activeProjectPath}
					totals={diffTotals(files)}
					selectedPath={selected?.path ?? null}
					composeRef={composeRef}
				/>
			</div>
		</section>
	)
}
