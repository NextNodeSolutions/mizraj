import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import type { ErrorInfo, ReactNode } from 'react'

import { logger } from '../logger'

type Props = {
	children: ReactNode
}

const ErrorFallback = ({ error }: FallbackProps): React.JSX.Element => (
	<main className="error-boundary">
		<h1>Something went wrong</h1>
		<pre>{error instanceof Error ? error.message : String(error)}</pre>
		<button type="button" onClick={() => window.location.reload()}>
			Reload
		</button>
	</main>
)

const handleError = (error: unknown, info: ErrorInfo): void => {
	const message = error instanceof Error ? error.message : String(error)
	const stack = error instanceof Error ? error.stack : undefined
	logger.error(message, {
		scope: 'error-boundary',
		details: {
			stack,
			componentStack: info.componentStack,
		},
	})
}

const ErrorBoundary = ({ children }: Props): React.JSX.Element => (
	<ReactErrorBoundary FallbackComponent={ErrorFallback} onError={handleError}>
		{children}
	</ReactErrorBoundary>
)

export default ErrorBoundary
