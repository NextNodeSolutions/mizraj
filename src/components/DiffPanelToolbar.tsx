import type { DiffLayout } from '../lib/useLayoutToggle'

type Props = {
	layout: DiffLayout
	onToggle: () => void
}

const DiffPanelToolbar = ({ layout, onToggle }: Props): React.JSX.Element => (
	<div className="diff-panel__toolbar" role="toolbar" aria-label="Diff layout">
		<button
			type="button"
			className="diff-panel__layout-toggle"
			aria-pressed={layout === 'stacked'}
			onClick={onToggle}
		>
			{layout === 'split' ? 'Stacked view' : 'Split view'}
		</button>
	</div>
)

export default DiffPanelToolbar
