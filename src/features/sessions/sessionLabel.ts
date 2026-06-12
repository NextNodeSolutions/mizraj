import type { SessionState } from './sessions'

// '/bin/zsh' -> 'zsh': the program name is the human label; an OSC 0/2 title
// set by the program wins while present. Falls back to the session id when
// the binary string is empty.
export const sessionLabel = (session: SessionState): string => {
	if (session.title) return session.title
	const name = session.binary.split('/').pop() ?? session.binary
	return name === '' ? session.id : name
}

// The repo a session works in, as a compact chip label: the directory name.
export const sessionRepoLabel = (session: SessionState): string | null => {
	if (session.repoPath === null) return null
	const name = session.repoPath.split('/').findLast(segment => segment !== '')
	return name ?? null
}
