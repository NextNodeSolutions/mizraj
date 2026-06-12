import { invoke } from '@tauri-apps/api/core'
import { getDefaultStore } from 'jotai'

import { agentRunHref, navigate } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { startSessionAtom } from './sessions'

type LaunchArgs = {
	binary: string
	repoPath: string
}

// Spawn a session and register it in the store, returning its id (null on a
// logged failure). The building block split panes use: no navigation.
export const spawnSession = async ({
	binary,
	repoPath,
}: LaunchArgs): Promise<string | null> => {
	try {
		const sessionId = await invoke<string>('session_create', {
			binary,
			cwd: repoPath,
		})
		getDefaultStore().set(startSessionAtom, {
			id: sessionId,
			binary,
			repoPath,
		})
		return sessionId
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`launchSession: session_create failed: ${message}`, {
			scope: 'run-agent',
			details: { stack, repoPath, binary },
		})
		return null
	}
}

// The user's default shell ($SHELL backend-side); an unreachable backend
// degrades to 'zsh' — session_create resolves it on PATH and reports its own
// (typed) failure if even that is missing.
export const defaultShell = async (): Promise<string> =>
	invoke<string>('session_default_shell').catch(() => 'zsh')

// Spawn a session, register it in the store and navigate to its pane — the
// shared path behind both "Run agent" and "New terminal". Resolves false on
// failure (logged), letting buttons clear their pending state.
export const launchSession = async (args: LaunchArgs): Promise<boolean> => {
	const sessionId = await spawnSession(args)
	if (sessionId === null) return false
	navigate(agentRunHref(sessionId))
	return true
}

// A plain terminal: the user's default shell, no agent.
export const launchShellSession = async (
	repoPath: string,
): Promise<boolean> => {
	const shell = await defaultShell()
	return launchSession({ binary: shell, repoPath })
}
