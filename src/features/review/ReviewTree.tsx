import { useAtomValue, useSetAtom } from 'jotai'

import type { ReviewFile, ReviewFileChange } from './reviewFiles'
import {
	reviewProgress,
	toggleViewedAtom,
	viewedFilesAtom,
} from './viewedFiles'

const CHANGE_BADGE: Readonly<Record<ReviewFileChange, string>> = {
	added: 'A',
	modified: 'M',
	deleted: 'D',
	renamed: 'R',
}

const fileName = (path: string): string => path.split('/').pop() ?? path

type Props = {
	files: ReadonlyArray<ReviewFile>
	selectedPath: string | null
	onSelect: (path: string) => void
}

export const ReviewTree = ({
	files,
	selectedPath,
	onSelect,
}: Props): React.JSX.Element => {
	const viewed = useAtomValue(viewedFilesAtom)
	const toggleViewed = useSetAtom(toggleViewedAtom)
	const progress = reviewProgress(
		viewed,
		files.map(file => file.path),
	)

	return (
		<nav className="review-tree" aria-label="Changed files">
			<div className="review-tree__progress">
				<span>
					{progress.viewed} / {progress.total} viewed
				</span>
				<span
					className="review-tree__bar"
					role="progressbar"
					aria-valuenow={progress.percent}
					aria-valuemin={0}
					aria-valuemax={100}
				>
					<i style={{ width: `${progress.percent}%` }} />
				</span>
			</div>
			<ul className="review-tree__list">
				{files.map(file => (
					<li key={file.path}>
						<div
							className="review-tree__file"
							data-viewed={Boolean(viewed[file.path])}
							aria-current={
								file.path === selectedPath ? 'true' : undefined
							}
						>
							<button
								type="button"
								className="review-tree__select"
								title={file.path}
								onClick={() => onSelect(file.path)}
							>
								<span
									className="review-tree__badge"
									data-change={file.change}
								>
									{CHANGE_BADGE[file.change]}
								</span>
								<span className="review-tree__name">
									{fileName(file.path)}
								</span>
								<span className="review-tree__stat">
									<span className="diff-add">
										+{file.additions}
									</span>{' '}
									{file.deletions > 0 && (
										<span className="diff-del">
											−{file.deletions}
										</span>
									)}
								</span>
							</button>
							<label className="review-tree__viewed">
								<input
									type="checkbox"
									checked={Boolean(viewed[file.path])}
									aria-label={`Mark ${file.path} viewed`}
									onChange={() => toggleViewed(file.path)}
								/>
							</label>
						</div>
					</li>
				))}
			</ul>
		</nav>
	)
}
