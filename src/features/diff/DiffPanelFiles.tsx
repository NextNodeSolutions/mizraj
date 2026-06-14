import type { ReviewFile } from '@/features/review/reviewFiles'
import { DiffStat } from '@/shared/ui/atoms'

type Props = {
	files: ReadonlyArray<ReviewFile>
	selectedPath: string | null
	onSelect: (path: string) => void
}

/** The dock's per-file rows: path + colored +/− stats, one selected. */
export const DiffPanelFiles = ({
	files,
	selectedPath,
	onSelect,
}: Props): React.JSX.Element => (
	<div className="fc-dfiles">
		{files.map(file => (
			<button
				type="button"
				key={file.path}
				className="dfile"
				data-on={file.path === selectedPath}
				onClick={() => onSelect(file.path)}
			>
				<span className="nm">{file.path}</span>
				<DiffStat add={file.additions} del={file.deletions} />
			</button>
		))}
	</div>
)
