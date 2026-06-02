import type { DiffLayout } from '@/shared/useLayoutToggle'

type Props = {
	layout: DiffLayout
	onToggle: () => void
	onClose?: () => void
}

export const DiffPanelToolbar = ({
	layout,
	onToggle,
	onClose,
}: Props): React.JSX.Element => (
	<div className="diff-panel__toolbar" role="toolbar" aria-label="Diff panel">
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
