import { useState } from 'react'

import { compactPath, projectName } from '@/features/projects/repoPaths'
import { launchSession } from '@/features/sessions/launchSession'
import { IconPlus } from '@/shared/ui/icons'

const AGENT_BINARY = 'claude'

type Props = {
	repos: ReadonlyArray<string>
}

/**
 * The wall's compact tail (MP4): registered repos with no live session.
 * Folded by default — dormant repos are one click away, never in the way.
 */
export const DormantSection = ({ repos }: Props): React.JSX.Element => {
	const [expanded, setExpanded] = useState(false)

	const label = repos.length === 1 ? 'dormant repo' : 'dormant repos'

	return (
		<section className="mc-dormant" aria-label="Dormant repositories">
			<button
				type="button"
				className="mc-dormant-head"
				aria-expanded={expanded}
				onClick={() => setExpanded(current => !current)}
			>
				<span>
					{repos.length} {label}
				</span>
				<span
					className="proj-chev"
					data-collapsed={expanded ? 'false' : 'true'}
				>
					▾
				</span>
			</button>
			{expanded && (
				<ul className="mc-dormant-list">
					{repos.map(repoPath => (
						<DormantRow key={repoPath} repoPath={repoPath} />
					))}
				</ul>
			)}
		</section>
	)
}

type RowProps = {
	repoPath: string
}

const DormantRow = ({ repoPath }: RowProps): React.JSX.Element => (
	<li className="mc-dormant-row">
		<span className="proj-name">{projectName(repoPath)}</span>
		<span className="proj-dir">{compactPath(repoPath)}</span>
		<span className="mz-spacer" />
		<button
			type="button"
			className="mz-iconbtn"
			aria-label={`New agent in ${projectName(repoPath)}`}
			onClick={() => {
				void launchSession({ binary: AGENT_BINARY, repoPath })
			}}
		>
			<IconPlus />
		</button>
	</li>
)
