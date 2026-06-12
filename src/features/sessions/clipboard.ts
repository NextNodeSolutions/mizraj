import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

// Thin seam over the official Tauri clipboard plugin (TP7): the OS clipboard
// via native APIs, not the webview's fragile navigator.clipboard. Failures are
// degraded, never thrown — a denied clipboard must not break the keybind that
// triggered it (copy becomes a no-op, paste pastes nothing).

export const writeClipboardText = async (text: string): Promise<void> => {
	try {
		await writeText(text)
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.warn(`clipboard: write failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack },
		})
	}
}

export const readClipboardText = async (): Promise<string | null> => {
	try {
		return await readText()
	} catch (error: unknown) {
		const { message, stack } = describeError(error)
		logger.warn(`clipboard: read failed: ${message}`, {
			scope: 'terminal-pane',
			details: { stack },
		})
		return null
	}
}
