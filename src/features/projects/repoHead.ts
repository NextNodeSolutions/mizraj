import { invoke } from '@tauri-apps/api/core'

import type { ResourceState } from '@/shared/repoResource'
import { useRepoResource } from '@/shared/repoResource'

export type RepoHead = {
	branch: string | null
	detached: boolean
}

/**
 * Compact label for a HEAD payload: the branch name, or a detached marker.
 */
export const repoHeadLabel = (head: RepoHead): string =>
	head.branch ?? 'detached HEAD'

const isRepoHead = (value: unknown): value is RepoHead =>
	typeof value === 'object' &&
	value !== null &&
	'branch' in value &&
	(typeof value.branch === 'string' || value.branch === null) &&
	'detached' in value &&
	typeof value.detached === 'boolean'

const fetchRepoHead = async (): Promise<RepoHead> => {
	const payload = await invoke<unknown>('repo_head')
	if (!isRepoHead(payload)) {
		throw new Error(`repo_head returned an unexpected payload`)
	}
	return payload
}

export const useRepoHead = (repoPath: string | null): ResourceState<RepoHead> =>
	useRepoResource(repoPath, fetchRepoHead, 'repo-head', 'useRepoHead').state
