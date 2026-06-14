import { useAtomValue, useSetAtom } from 'jotai'

import { toggleViewedAtom, viewedFilesAtom } from './viewedFiles'

type Props = {
	path: string
	label?: string
	className?: string
}

/**
 * The animated "viewed" toggle (design .vchk) — one per tree row, plus one
 * in the diff pane's sub-header; both flip the same path in viewedFilesAtom
 * so the progress bar advances wherever the file gets ticked.
 */
export const ViewedCheck = ({
	path,
	label,
	className,
}: Props): React.JSX.Element => {
	const viewed = Boolean(useAtomValue(viewedFilesAtom)[path])
	const toggleViewed = useSetAtom(toggleViewedAtom)

	return (
		<button
			type="button"
			className={
				className === undefined
					? 'review__vchk-btn'
					: `review__vchk-btn ${className}`
			}
			data-done={viewed ? 'true' : 'false'}
			aria-pressed={viewed}
			aria-label={`Mark ${path} viewed`}
			onClick={event => {
				// The tree row around the check selects the file on click —
				// ticking a file off must not also switch the diff to it.
				event.stopPropagation()
				toggleViewed(path)
			}}
		>
			<span className="vchk" data-done={viewed ? 'true' : 'false'}>
				{viewed ? '✓' : ''}
			</span>
			{label !== undefined && <span>{label}</span>}
		</button>
	)
}
