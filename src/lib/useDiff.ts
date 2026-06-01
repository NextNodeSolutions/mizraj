import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

type DiffPayload = { patch: string }

export type DiffLoadState =
	| { status: 'loading' }
	| { status: 'ready'; patch: string }
	| { status: 'error'; message: string }

export const useDiff = (): DiffLoadState => {
	const [state, setState] = useState<DiffLoadState>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		setState({ status: 'loading' })
		invoke<DiffPayload>('get_diff')
			.then(payload => {
				if (cancelled) return
				setState({ status: 'ready', patch: payload.patch })
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`useDiff: get_diff failed: ${message}`, {
					scope: 'diff-panel',
					details: { stack },
				})
				if (cancelled) return
				setState({ status: 'error', message })
			})
		return () => {
			cancelled = true
		}
	}, [])

	return state
}
