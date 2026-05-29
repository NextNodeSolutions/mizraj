import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export type DiffView = 'session' | 'working_tree' | 'head_base'

type DiffPayload = { patch: string }

export type DiffLoadState =
	| { status: 'loading' }
	| { status: 'ready'; patch: string }
	| { status: 'error'; message: string }

export const useDiff = (sessionId: string, view: DiffView): DiffLoadState => {
	const [state, setState] = useState<DiffLoadState>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		setState({ status: 'loading' })
		invoke<DiffPayload>('get_diff', { sessionId, view })
			.then(payload => {
				if (cancelled) return
				setState({ status: 'ready', patch: payload.patch })
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`useDiff: get_diff failed: ${message}`, {
					scope: 'diff-panel',
					details: { stack, sessionId, view },
				})
				if (cancelled) return
				setState({ status: 'error', message })
			})
		return () => {
			cancelled = true
		}
	}, [sessionId, view])

	return state
}
