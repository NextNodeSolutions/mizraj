import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useMemo, useState } from 'react'

import { navigate, reviewHref } from '@/app/router'
import { reviewFilesFromParsed } from '@/features/review/reviewFiles'
import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'
import { PanelHead } from '@/shared/ui/atoms'

import { DiffPanelBody } from './DiffPanelBody'
import { DiffPanelFiles } from './DiffPanelFiles'
import { useDiff } from './useDiff'

type Props = {
	repoPath: string | null
}

const usePatchFiles = (patch: string | null): ReadonlyArray<FileDiffMetadata> =>
	useMemo(
		() =>
			patch === null
				? []
				: parsePatchFiles(patch).flatMap(parsed => parsed.files),
		[patch],
	)

/**
 * The cockpit's diff dock: a preview-only panel over the active project's
 * working-tree patch — per-file rows with +/− stats and a unified preview of
 * the selected file. Full review tooling lives on /review ("Open review ↗"
 * and re-clicking the selected row deep-link there with the file).
 */
export const DiffPanel = ({ repoPath }: Props): React.JSX.Element => {
	const { state } = useDiff(repoPath)
	const patch = state.status === 'ready' ? state.data.patch : null
	const parsedFiles = usePatchFiles(patch)
	const files = useMemo(
		() => reviewFilesFromParsed(parsedFiles),
		[parsedFiles],
	)
	const [selectedPath, setSelectedPath] = useState<string | null>(null)

	const selected =
		files.find(file => file.path === selectedPath) ?? files[0] ?? null
	// Selection and the FileDiff `key` both index by `FileDiffMetadata.name`,
	// which assumes names are unique within the patch. That holds here: this is
	// always one working-tree patch (`git diff`), where each path appears once.
	// A multi-commit or rename-tracked patch could repeat a name and break the
	// lookup — out of scope for this preview-only dock.
	const selectedMeta =
		parsedFiles.find(file => file.name === selected?.path) ?? null

	// Re-clicking the selected row is the "drill in" gesture: it opens the
	// full review preselected on that file instead of re-selecting.
	const selectRow = (path: string): void => {
		if (path === selected?.path) {
			navigate(reviewHref(path))
			return
		}
		setSelectedPath(path)
	}

	return (
		<aside className="panel fc-diffs" aria-label="Diffs">
			<PanelHead title="Diffs" count={`${files.length} files`}>
				<button
					type="button"
					className="btn btn-sm btn-outline"
					onClick={() => navigate(reviewHref(selected?.path))}
				>
					Open review ↗
				</button>
			</PanelHead>
			<DiffPanelBody state={state}>
				<DiffPanelFiles
					files={files}
					selectedPath={selected?.path ?? null}
					onSelect={selectRow}
				/>
				<div className="fc-dhunk">
					{selectedMeta !== null && (
						<FileDiff
							key={selectedMeta.name}
							fileDiff={selectedMeta}
							options={{
								diffStyle: 'unified',
								theme: NEXTNODE_DIFF_THEME,
							}}
						/>
					)}
				</div>
			</DiffPanelBody>
		</aside>
	)
}
