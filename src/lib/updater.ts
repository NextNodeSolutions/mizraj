import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

import { describeError } from '../errors'
import { logger } from '../logger'

const SKIPPED_UPDATE_STORAGE_KEY = 'agent-cockpit:updater:skipped-version'

export const runUpdaterCheck = async (): Promise<void> => {
	try {
		const update = await check()
		if (!update) {
			return
		}
		if (
			localStorage.getItem(SKIPPED_UPDATE_STORAGE_KEY) === update.version
		) {
			return
		}
		const accepted = await ask(
			`Agent Cockpit ${update.version} is available. Install and restart now?`,
			{
				title: 'Update available',
				kind: 'info',
				okLabel: 'Install and restart',
				cancelLabel: 'Skip this version',
			},
		)
		if (!accepted) {
			localStorage.setItem(SKIPPED_UPDATE_STORAGE_KEY, update.version)
			return
		}
		localStorage.removeItem(SKIPPED_UPDATE_STORAGE_KEY)
		await update.downloadAndInstall()
		await relaunch()
	} catch (error) {
		const { message, stack } = describeError(error)
		logger.error(`Updater check failed: ${message}`, {
			scope: 'updater',
			details: { stack },
		})
	}
}
