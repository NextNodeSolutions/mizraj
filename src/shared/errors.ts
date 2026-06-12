// Mirrors the wire shape of the Rust `SessionError` (src-tauri/src/session/
// error.rs): a Tauri command rejection arrives here as the serialized enum,
// `{ kind, <detail> }` — NOT a JS `Error`. Keep these variants in sync with the
// backend `Serialize` impl.
export type SessionError =
	| { kind: 'binary_not_found'; binary: string }
	| { kind: 'spawn'; message: string }
	| { kind: 'path_probe'; message: string }
	| { kind: 'not_found'; session_id: string }
	| { kind: 'input_closed'; message: string }
	| { kind: 'session_ref'; message: string }
	| { kind: 'database'; message: string }
	| { kind: 'resize'; message: string }
	| { kind: 'frame_unavailable'; session_id: string }

export type SessionErrorKind = SessionError['kind']

// The string detail each variant carries on the wire. Typed as a total record
// over the union so adding/removing a kind is a compile error here.
const SESSION_ERROR_DETAIL: Record<SessionErrorKind, string> = {
	binary_not_found: 'binary',
	spawn: 'message',
	path_probe: 'message',
	not_found: 'session_id',
	input_closed: 'message',
	session_ref: 'message',
	database: 'message',
	resize: 'message',
	frame_unavailable: 'session_id',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const isSessionErrorKind = (kind: string): kind is SessionErrorKind =>
	kind in SESSION_ERROR_DETAIL

export const isSessionError = (value: unknown): value is SessionError => {
	if (!isRecord(value)) return false
	const { kind } = value
	if (typeof kind !== 'string' || !isSessionErrorKind(kind)) return false
	return typeof value[SESSION_ERROR_DETAIL[kind]] === 'string'
}

// Reconstruct the human message the backend's `#[error(...)]` would have
// produced, so logs read `session not found: 01KT…` instead of `[object Object]`.
const formatSessionError = (error: SessionError): string => {
	switch (error.kind) {
		case 'binary_not_found':
			return `binary not found on PATH: ${error.binary}`
		case 'spawn':
			return `failed to spawn pty: ${error.message}`
		case 'path_probe':
			return `failed to probe login-shell PATH: ${error.message}`
		case 'not_found':
			return `session not found: ${error.session_id}`
		case 'input_closed':
			return error.message
		case 'session_ref':
			return `failed to register session ref: ${error.message}`
		case 'database':
			return `database error: ${error.message}`
		case 'resize':
			return `failed to resize pty: ${error.message}`
		case 'frame_unavailable':
			return `no terminal frame available for session: ${error.session_id}`
	}
}

// Last resort for an unknown rejection shape: JSON over `[object Object]`, with
// String() as a guard against circular refs or non-serializable values.
const stringifyUnknown = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}

export const describeError = (
	error: unknown,
): { message: string; stack: string | undefined } => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack }
	}
	if (isSessionError(error)) {
		return { message: formatSessionError(error), stack: undefined }
	}
	if (typeof error === 'string') {
		return { message: error, stack: undefined }
	}
	return { message: stringifyUnknown(error), stack: undefined }
}
