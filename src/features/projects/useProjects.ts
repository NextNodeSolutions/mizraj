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

/**
 * Registered repos whose folder no longer exists on disk. A subset of
 * {@link projectsAtom}, refreshed lazily (it requires a filesystem probe), so
 * surfaces can flag vanished repos without re-listing the whole registry.
 */
export const missingProjectsAtom = atom<ReadonlyArray<string>>([])

const isPathList = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(entry => typeof entry === 'string')

const fetchPathList = async (
	command: 'projects_list' | 'projects_missing',
): Promise<ReadonlyArray<string>> => {
	const payload = await invoke<unknown>(command)
	if (!isPathList(payload)) {
		throw new Error(`${command} returned an unexpected payload`)
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

// The registry is global truth: the first surface to mount loads it, every later
// surface (picker, pipeline, mission control, ×StrictMode) reuses the atoms
// rather than refetching. Mirrors the `bridgeStarted` guard in repoEvents.ts.
let registryLoaded = false

export type ProjectsApi = {
	projects: ReadonlyArray<string>
	/** Registered repos whose folder is gone from disk (subset of `projects`). */
	missing: ReadonlyArray<string>
	/** Register a repo; resolves to its canonical path, or null on failure. */
	addProject: (path: string) => Promise<string | null>
	removeProject: (path: string) => Promise<void>
	/** Re-probe the filesystem for vanished repos (cheap; call on menu open). */
	refreshMissing: () => Promise<void>
}

export const useProjects = (): ProjectsApi => {
	const [projects, setProjects] = useAtom(projectsAtom)
	const [missing, setMissing] = useAtom(missingProjectsAtom)

	useEffect(() => {
		if (registryLoaded) return
		registryLoaded = true
		let cancelled = false
		fetchPathList('projects_list')
			.then(list => {
				if (!cancelled) setProjects(list)
			})
			.catch((error: unknown) => {
				registryLoaded = false
				logRegistryError('projects_list', error)
			})
		fetchPathList('projects_missing')
			.then(gone => {
				if (!cancelled) setMissing(gone)
			})
			.catch((error: unknown) => {
				logRegistryError('projects_missing', error)
			})
		return () => {
			cancelled = true
		}
	}, [setProjects, setMissing])

	const refreshMissing = async (): Promise<void> => {
		try {
			setMissing(await fetchPathList('projects_missing'))
		} catch (error: unknown) {
			logRegistryError('projects_missing', error)
		}
	}

	const addProject = async (path: string): Promise<string | null> => {
		try {
			const canonical = await invoke<string>('projects_add', {
				repoPath: path,
			})
			// `projects_add` returns the backend-canonicalized path, which may
			// differ from the stored form (symlink, trailing slash, macOS case),
			// so a local includes() can't tell new from existing. Re-list to
			// reconcile with backend truth and avoid a duplicate entry.
			setProjects(await fetchPathList('projects_list'))
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
			setMissing(known => known.filter(entry => entry !== path))
		} catch (error: unknown) {
			logRegistryError('projects_remove', error)
		}
	}

	return { projects, missing, addProject, removeProject, refreshMissing }
}

// Test-only escape hatch: clear the one-time load guard so each suite mounts
// against a clean registry (mirrors resetRepoEventsForTests in repoEvents.ts).
export const resetProjectsForTests = (): void => {
	registryLoaded = false
}
