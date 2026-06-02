import {
	ConsoleTransport,
	createLogger,
	detectRuntime,
	safeStringify,
} from '@nextnode-solutions/logger'
import type { LogEntry, Logger, Transport } from '@nextnode-solutions/logger'
import { invoke } from '@tauri-apps/api/core'

const LOG_COMMAND = 'log_from_frontend'

class TauriTransport implements Transport {
	async log(entry: LogEntry): Promise<void> {
		if (detectRuntime() !== 'browser') return

		try {
			await invoke(LOG_COMMAND, {
				level: entry.level,
				message: entry.message,
				scope: entry.scope ?? null,
				requestId: entry.requestId,
				details: entry.object ? safeStringify(entry.object) : null,
			})
		} catch (forwardError) {
			// oxlint-disable-next-line no-console -- fallback when the logger itself fails
			console.warn(
				'[logger] failed to forward log to Tauri',
				forwardError,
			)
		}
	}
}

const isDevelopment = import.meta.env.DEV

const transports: Transport[] = [new TauriTransport()]
if (isDevelopment) {
	transports.unshift(new ConsoleTransport({ environment: 'development' }))
}

export const logger: Logger = createLogger({
	scope: 'app',
	environment: isDevelopment ? 'development' : 'production',
	transports,
})
