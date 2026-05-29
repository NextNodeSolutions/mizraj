import type { ChangeEvent } from 'react'

import type { DiffView } from '../lib/useDiff'
import type { DiffLayout } from '../lib/useLayoutToggle'

type ViewOption = {
	value: DiffView
	label: string
}

const VIEW_OPTIONS: readonly ViewOption[] = [
	{ value: 'session', label: 'Session' },
	{ value: 'working_tree', label: 'Working tree' },
	{ value: 'head_base', label: 'HEAD vs base' },
]

type Props = {
	view: DiffView
	onViewChange: (next: DiffView) => void
	layout: DiffLayout
	onToggle: () => void
	onClose?: () => void
}

const DiffPanelToolbar = ({
	view,
	onViewChange,
	layout,
	onToggle,
	onClose,
}: Props): React.JSX.Element => {
	const handleViewChange = (event: ChangeEvent<HTMLSelectElement>): void => {
		const next = event.target.value
		if (
			next === 'session' ||
			next === 'working_tree' ||
			next === 'head_base'
		) {
			onViewChange(next)
		}
	}

	return (
		<div
			className="diff-panel__toolbar"
			role="toolbar"
			aria-label="Diff panel"
		>
			<label className="diff-panel__view-selector">
				<span className="diff-panel__view-label">View</span>
				<select
					className="diff-panel__view-select"
					value={view}
					onChange={handleViewChange}
				>
					{VIEW_OPTIONS.map(option => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
			<button
				type="button"
				className="diff-panel__layout-toggle"
				aria-pressed={layout === 'stacked'}
				onClick={onToggle}
			>
				{layout === 'split' ? 'Stacked view' : 'Split view'}
			</button>
			{onClose && (
				<button
					type="button"
					className="diff-panel__close"
					aria-label="Hide diffs"
					onClick={onClose}
				>
					›
				</button>
			)}
		</div>
	)
}

export default DiffPanelToolbar
