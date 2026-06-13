import { invoke } from '@tauri-apps/api/core'
import { atom, useAtom } from 'jotai'
import { useEffect } from 'react'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

/**
 * The project registry (every repo the app knows about), shared by all
 * multi-repo surfaces: TopBar picker, Mission Control, Pipeline.
 */
export const projectsAtom = atom<ReadonlyArray<string>>([])

const isPathList = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(entry => typeof entry === 'string')

const fetchProjects = async (): Promise<ReadonlyArray<string>> => {
	const payload = await invoke<unknown>('projects_list')
	if (!isPathList(payload)) {
		throw new Error('projects_list returned an unexpected payload')
	}
	return payload
}

const logRegistryError = (operation: string, error: unknown): void => {
	const { message, stack } = describeError(error)
	logger.error(`useProjects: ${operation} failed: ${message}`, {
		scope: 'projects',
		details: { stack },
	})
}

export type ProjectsApi = {
	projects: ReadonlyArray<string>
	/** Register a repo; resolves to its canonical path, or null on failure. */
	addProject: (path: string) => Promise<string | null>
	removeProject: (path: string) => Promise<void>
}

export const useProjects = (): ProjectsApi => {
	const [projects, setProjects] = useAtom(projectsAtom)

	useEffect(() => {
		let cancelled = false
		fetchProjects()
			.then(list => {
				if (!cancelled) setProjects(list)
			})
			.catch((error: unknown) => {
				logRegistryError('projects_list', error)
			})
		return () => {
			cancelled = true
		}
	}, [setProjects])

	const addProject = async (path: string): Promise<string | null> => {
		try {
			const canonical = await invoke<string>('projects_add', {
				repoPath: path,
			})
			setProjects(known =>
				known.includes(canonical) ? known : [...known, canonical],
			)
			return canonical
		} catch (error: unknown) {
			logRegistryError('projects_add', error)
			return null
		}
	}

	const removeProject = async (path: string): Promise<void> => {
		try {
			await invoke('projects_remove', { repoPath: path })
			setProjects(known => known.filter(entry => entry !== path))
		} catch (error: unknown) {
			logRegistryError('projects_remove', error)
		}
	}

	return { projects, addProject, removeProject }
}
