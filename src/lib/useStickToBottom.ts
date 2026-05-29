import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { ListImperativeAPI } from 'react-window'

const STICK_THRESHOLD_PX = 4

type StickToBottom = {
	onScroll: (event: React.UIEvent<HTMLDivElement>) => void
}

export const useStickToBottom = (
	listRef: RefObject<ListImperativeAPI | null>,
	itemCount: number,
): StickToBottom => {
	const stickToBottomRef = useRef(true)

	useEffect(() => {
		if (!stickToBottomRef.current) return
		if (itemCount === 0) return
		const api = listRef.current
		if (api === null) return
		api.scrollToRow({
			align: 'end',
			behavior: 'auto',
			index: itemCount - 1,
		})
	}, [itemCount, listRef])

	const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
		const target = event.currentTarget
		const distanceFromBottom =
			target.scrollHeight - target.scrollTop - target.clientHeight
		stickToBottomRef.current = distanceFromBottom <= STICK_THRESHOLD_PX
	}

	return { onScroll }
}
