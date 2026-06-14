import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from '@/app/App'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { startAgentEventsBridge } from '@/features/sessions/agentEventsBridge'
import { startGhosttyConfigBridge } from '@/features/sessions/ghosttyConfigBridge'
import { startSplitLifecycle } from '@/features/sessions/splitLayout'
import { startTerminalInputRouter } from '@/features/sessions/terminalInput'
import { DiffWorkerPool } from '@/shared/diffWorkerPool'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { runUpdaterCheck } from '@/shared/updater'

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

startAgentEventsBridge()
startGhosttyConfigBridge()
startSplitLifecycle()
startTerminalInputRouter()

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
	// The diff worker pool sits above StrictMode so its session-long singleton
	// initializes once, instead of being torn down and rebuilt by StrictMode's
	// double-invoked effects in development.
	<DiffWorkerPool>
		<React.StrictMode>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</React.StrictMode>
	</DiffWorkerPool>,
)

if (import.meta.env.PROD) {
	void runUpdaterCheck()
}
