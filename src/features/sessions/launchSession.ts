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

// Spawn a session, register it in the store and navigate to its pane — the
// shared path behind both "Run agent" and "New terminal". Resolves false on
// failure (logged), letting buttons clear their pending state.
export const launchSession = async ({
	binary,
	repoPath,
}: LaunchArgs): Promise<boolean> => {
	try {
		const sessionId = await invoke<string>('session_create', {
			binary,
			cwd: repoPath,
		})
		getDefaultStore().set(startSessionAtom, { id: sessionId, binary })
		navigate(agentRunHref(sessionId))
		return true
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`launchSession: session_create failed: ${message}`, {
			scope: 'run-agent',
			details: { stack, repoPath, binary },
		})
		return false
	}
}

// A plain terminal: the user's default shell ($SHELL backend-side), no agent.
// An unreachable backend degrades to 'zsh' — session_create resolves it on
// PATH and reports its own (typed) failure if even that is missing.
export const launchShellSession = async (
	repoPath: string,
): Promise<boolean> => {
	const shell = await invoke<string>('session_default_shell').catch(
		() => 'zsh',
	)
	return launchSession({ binary: shell, repoPath })
}
