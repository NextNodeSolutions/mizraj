import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { describeError } from '../errors'
import { logger } from '../logger'

export const useActiveProject = (path: string | null): string | null => {
	const [synced, setSynced] = useState<string | null>(null)

	useEffect(() => {
		if (path === null) {
			setSynced(null)
			return
		}
		let cancelled = false
		invoke('set_active_project', { repoPath: path })
			.then(() => {
				if (!cancelled) setSynced(path)
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(
					`useActiveProject: set_active_project failed: ${message}`,
					{
						scope: 'active-project',
						details: { stack, path },
					},
				)
			})
		return () => {
			cancelled = true
		}
	}, [path])

	return synced
}
