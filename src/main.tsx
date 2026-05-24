import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { describeError } from './errors'
import { logger } from './logger'

window.addEventListener('error', event => {
	const { stack } = describeError(event.error)
	logger.error(event.message, {
		scope: 'window',
		details: {
			filename: event.filename,
			lineno: event.lineno,
			colno: event.colno,
			stack,
		},
	})
})

window.addEventListener('unhandledrejection', event => {
	const { message, stack } = describeError(event.reason)
	logger.error(`Unhandled promise rejection: ${message}`, {
		scope: 'window',
		details: { stack },
	})
})

const rootElement = document.getElementById('root')
if (!rootElement) {
	throw new Error('Root element #root not found')
}

logger.info('Frontend bootstrapping')

type ReactErrorInfo = { componentStack?: string | null }

const makeReactHandler =
	(level: 'error' | 'warn' | 'info') =>
	(error: unknown, errorInfo: ReactErrorInfo) => {
		const { message, stack } = describeError(error)
		logger[level](message, {
			scope: 'react',
			details: { componentStack: errorInfo.componentStack, stack },
		})
	}

const reactErrorHandlers: Parameters<typeof ReactDOM.createRoot>[1] =
	import.meta.env.DEV
		? undefined
		: {
				onUncaughtError: makeReactHandler('error'),
				onCaughtError: makeReactHandler('warn'),
				onRecoverableError: makeReactHandler('info'),
			}

ReactDOM.createRoot(rootElement, reactErrorHandlers).render(
	<React.StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</React.StrictMode>,
)

const SKIPPED_UPDATE_STORAGE_KEY = 'agent-cockpit:updater:skipped-version'

void (async () => {
	if (import.meta.env.DEV) {
		return
	}
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
})()
