import { writeClipboardText } from '@/features/sessions/clipboard'
import { spawnSession } from '@/features/sessions/launchSession'
import type { Task } from '@/features/tasks/tasks'
import { updateTask } from '@/features/tasks/tasks'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { pushToast } from '@/shared/toasts'

const AGENT_BINARY = 'claude'

/**
 * The instruction block an agent should start from: the task title, its
 * description and the done-when criterion when present.
 */
export const taskPrompt = (task: Task): string =>
	[
		task.title,
		task.description,
		task.doneWhen === null ? null : `Done when: ${task.doneWhen}`,
	]
		.filter(part => part !== null && part !== '')
		.join('\n\n')

/**
 * One-click "Launch agent" on a backlog card: spawn an agent session in the
 * repo, flag the task in progress and arm the clipboard with the task
 * prompt. No navigation — the board stays visible so the user watches the
 * card move into Running. A failed spawn leaves the task untouched and
 * reports null; success reports the new session id so the view can mark
 * its card fresh.
 *
 * The spawned agent is the real, irreversible side effect: once it lives,
 * the launch is a success even if the post-spawn bookkeeping (task flag,
 * clipboard) rejects. So those steps run inside a guard — the session id
 * still returns, the card moves to Running optimistically, and the failure
 * surfaces as a non-blocking warning rather than swallowing the launch.
 */
export const launchTaskAgent = async (task: Task): Promise<string | null> => {
	// The agent spawns in the task's own repo (MP5): a launch from a repo-B
	// card lands on B even while the preference points at A.
	const sessionId = await spawnSession({
		binary: AGENT_BINARY,
		repoPath: task.repoPath,
	})
	if (sessionId === null) {
		pushToast('Agent launch failed — see logs')
		return null
	}

	try {
		await updateTask({
			repoPath: task.repoPath,
			id: task.id,
			title: task.title,
			description: task.description,
			status: 'in_progress',
		})
		//TODO: session_create has no initial-prompt channel — launchTaskAgent
		// arms the clipboard with taskPrompt(task) and the toast tells the user
		// to paste (existing v1 behavior, kept in v2).
		await writeClipboardText(taskPrompt(task))
		pushToast('Agent launched — task prompt is in your clipboard')
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.error(`launchTaskAgent: post-spawn step failed: ${message}`, {
			scope: 'pipeline',
			details: { stack, sessionId, taskId: task.id },
		})
		pushToast('Agent launched — could not update the task, see logs')
	}
	return sessionId
}
