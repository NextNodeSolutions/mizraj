import { useAtomValue } from 'jotai'

import type { SplitNode } from './splitLayout'
import { leaf, splitTreesAtom } from './splitLayout'
import { TerminalPane } from './TerminalPane'

const SplitNodeView = ({ node }: { node: SplitNode }): React.JSX.Element => {
	if (node.kind === 'leaf') {
		return <TerminalPane sessionId={node.sessionId} />
	}
	return (
		<div className={`terminal-split terminal-split--${node.orientation}`}>
			<SplitNodeView node={node.children[0]} />
			<SplitNodeView node={node.children[1]} />
		</div>
	)
}

type Props = {
	rootId: string
}

// The pane area of one routed view: its split tree when new_split grew one,
// else the root session as a single full-size pane.
export const SplitTreeView = ({ rootId }: Props): React.JSX.Element => {
	const trees = useAtomValue(splitTreesAtom)
	return <SplitNodeView node={trees[rootId] ?? leaf(rootId)} />
}
