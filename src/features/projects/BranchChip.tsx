import { repoHeadLabel, useRepoHead } from './repoHead'

type Props = {
	repoPath: string | null
}

/**
 * The checked-out branch of a repo as a small mono chip — renders nothing
 * until the head is known so layouts never jump on an error.
 */
export const BranchChip = ({ repoPath }: Props): React.JSX.Element | null => {
	const head = useRepoHead(repoPath)
	if (head.status !== 'ready') return null
	return (
		<span className="branch-chip" title={repoPath ?? undefined}>
			⎇ {repoHeadLabel(head.data)}
		</span>
	)
}
