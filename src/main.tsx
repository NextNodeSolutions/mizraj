import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { logger } from './logger'

window.addEventListener('error', event => {
	logger.error(event.message, {
		scope: 'window',
		details: {
			filename: event.filename,
			lineno: event.lineno,
			colno: event.colno,
			stack: event.error instanceof Error ? event.error.stack : undefined,
		},
	})
})

window.addEventListener('unhandledrejection', event => {
	const reason = event.reason
	const message = reason instanceof Error ? reason.message : String(reason)
	logger.error(`Unhandled promise rejection: ${message}`, {
		scope: 'window',
		details: {
			stack: reason instanceof Error ? reason.stack : undefined,
		},
	})
})

const rootElement = document.getElementById('root')
if (!rootElement) {
	throw new Error('Root element #root not found')
}

logger.info('Frontend bootstrapping')

const describeError = (
	error: unknown,
): { message: string; stack: string | undefined } => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack }
	}
	return { message: String(error), stack: undefined }
}

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
		<App />
	</React.StrictMode>,
)
