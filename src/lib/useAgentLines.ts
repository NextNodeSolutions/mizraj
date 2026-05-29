import { atom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { sessionsAtom } from '../state/sessions'
import type { OutputChunk, OutputChunkKind } from '../state/sessions'

export type AgentLine = { text: string; kind: OutputChunkKind }

const linesFromChunks = (chunks: ReadonlyArray<OutputChunk>): AgentLine[] => {
	const lines: AgentLine[] = []
	let buf = ''
	let bufKind: OutputChunkKind | null = null
	for (const chunk of chunks) {
		const segments = chunk.text.split('\n')
		for (let i = 0; i < segments.length; i += 1) {
			const segment = segments[i] ?? ''
			if (i > 0) {
				lines.push({ text: buf, kind: bufKind ?? chunk.kind })
				buf = ''
				bufKind = null
			}
			if (segment !== '') {
				if (bufKind === null) bufKind = chunk.kind
				buf += segment
			}
		}
	}
	if (bufKind !== null) {
		lines.push({ text: buf, kind: bufKind })
	}
	return lines
}

export const useAgentLines = (sessionId: string): AgentLine[] => {
	const sessionAtom = useMemo(
		() => atom(get => get(sessionsAtom)[sessionId]),
		[sessionId],
	)
	const session = useAtomValue(sessionAtom)
	return useMemo(
		() => linesFromChunks(session?.output ?? []),
		[session?.output],
	)
}
