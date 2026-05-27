export const describeError = (
	error: unknown,
): { message: string; stack: string | undefined } => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack }
	}
	return { message: String(error), stack: undefined }
}

export type SessionError =
	| { kind: 'binary_not_found'; binary: string }
	| { kind: 'spawn'; message: string }
	| { kind: 'path_probe'; message: string }

export type SessionErrorKind = SessionError['kind']

export const isSessionError = (value: unknown): value is SessionError => {
	if (typeof value !== 'object' || value === null || !('kind' in value)) {
		return false
	}
	const { kind } = value
	return (
		kind === 'binary_not_found' ||
		kind === 'spawn' ||
		kind === 'path_probe'
	)
}
