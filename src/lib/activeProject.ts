import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export const useActiveProject = (path: string | null): string | null => {
	const [synced, setSynced] = useState<string | null>(null)
	const latestRequestId = useRef(0)

	useEffect(() => {
		if (path === null) {
			latestRequestId.current += 1
			setSynced(null)
			return
		}
		latestRequestId.current += 1
		const requestId = latestRequestId.current
		invoke('set_active_project', { repoPath: path })
			.then(() => {
				if (requestId !== latestRequestId.current) return
				setSynced(path)
			})
			.catch((error: unknown) => {
				if (requestId !== latestRequestId.current) return
				const { message, stack } = describeError(error)
				logger.error(
					`useActiveProject: set_active_project failed: ${message}`,
					{
						scope: 'active-project',
						details: { stack, path },
					},
				)
			})
	}, [path])

	return synced
}
