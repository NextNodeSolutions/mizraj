import type { SessionState } from './sessions'

// '/bin/zsh' -> 'zsh': the trailing path segment of a binary path.
const binaryBasename = (binary: string): string =>
	binary.split('/').pop() ?? binary

// '/bin/zsh' -> 'zsh': the program name is the human label; an OSC 0/2 title
// set by the program wins while present. Falls back to the session id when
// the binary string is empty.
export const sessionLabel = (session: SessionState): string => {
	if (session.title) return session.title
	const name = binaryBasename(session.binary)
	return name === '' ? session.id : name
}

// TODO(backend): load_ghostty_config DTO (src-tauri/src/ghostty/dto.rs) exposes resolved colors but not the theme name. Render 'ghostty · {basename(session.binary)}' until the name field is added.
export const contextLabel = (session: SessionState): string =>
	`ghostty · ${binaryBasename(session.binary)}`

// The repo a session works in, as a compact chip label: the directory name.
export const sessionRepoLabel = (session: SessionState): string | null => {
	if (session.repoPath === null) return null
	const name = session.repoPath.split('/').findLast(segment => segment !== '')
	return name ?? null
}
