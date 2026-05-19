export const describeError = (
	error: unknown,
): { message: string; stack: string | undefined } => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack }
	}
	return { message: String(error), stack: undefined }
}
