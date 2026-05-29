import { useMemo } from 'react'
import { List, useListRef } from 'react-window'
import type { RowComponentProps } from 'react-window'

import { useAgentLines } from '../lib/useAgentLines'
import type { AgentLine } from '../lib/useAgentLines'
import { useStickToBottom } from '../lib/useStickToBottom'

const ROW_HEIGHT_PX = 22

type LogRowProps = { lines: ReadonlyArray<AgentLine> }

const LogRow = ({
	index,
	style,
	lines,
}: RowComponentProps<LogRowProps>): React.JSX.Element => {
	const line = lines[index]
	const text = line?.text ?? ''
	const kind = line?.kind ?? 'stdout'
	return (
		<div
			style={style}
			className={`agent-log__line agent-log__line--${kind}`}
		>
			{text === '' ? ' ' : text}
		</div>
	)
}

type Props = {
	sessionId: string
}

const AgentLog = ({ sessionId }: Props): React.JSX.Element => {
	const lines = useAgentLines(sessionId)
	const listRef = useListRef(null)
	const { onScroll } = useStickToBottom(listRef, lines.length)
	const rowProps = useMemo(() => ({ lines }), [lines])

	return (
		<List
			className="agent-log"
			style={{ height: '100%', width: '100%' }}
			listRef={listRef}
			rowComponent={LogRow}
			rowCount={lines.length}
			rowHeight={ROW_HEIGHT_PX}
			rowProps={rowProps}
			defaultHeight={400}
			onScroll={onScroll}
		/>
	)
}

export default AgentLog
