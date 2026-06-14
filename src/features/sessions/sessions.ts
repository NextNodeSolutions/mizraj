import { atom } from 'jotai'

import type { CellFramePayload } from './terminalWire'

export type SessionStatus = 'running' | 'ended'

export type SessionState = {
	id: string
	/// The spawned program ('claude' for agent runs, the user's shell for
	/// plain terminals) — what the sidebar labels the session with.
	binary: string
	/// The repo the session was launched in — what a split spawned from this
	/// session inherits as its working directory.
	repoPath: string | null
	/// The OSC 0/2 title the program set, when any — overrides the derived
	/// label while present (TP13).
	title: string | null
	status: SessionStatus
	exitCode: number | null
	/// Epoch ms the session was registered — what relative "age" labels are
	/// computed from.
	startedAt: number
}

export type SessionEndPayload = {
	session_id: string
	exit_code: number
}

export const AGENT_END_EVENT = 'agent:end'

export const AGENT_CELLS_EVENT = 'agent:cells'

export const AGENT_TITLE_EVENT = 'agent:title'

export type TitlePayload = {
	session_id: string
	title: string | null
}

type SessionsMap = Readonly<Record<string, SessionState>>

export const sessionsAtom = atom<SessionsMap>({})

type StartSessionArgs = { id: string; binary: string; repoPath: string | null }

export const startSessionAtom = atom(
	null,
	(get, set, { id, binary, repoPath }: StartSessionArgs) => {
		set(sessionsAtom, {
			...get(sessionsAtom),
			[id]: {
				id,
				binary,
				repoPath,
				title: null,
				status: 'running',
				exitCode: null,
				startedAt: Date.now(),
			},
		})
	},
)

type SetTitleArgs = { sessionId: string; title: string | null }

export const setSessionTitleAtom = atom(
	null,
	(get, set, { sessionId, title }: SetTitleArgs) => {
		const sessions = get(sessionsAtom)
		const existing = sessions[sessionId]
		if (!existing) return
		set(sessionsAtom, {
			...sessions,
			[sessionId]: { ...existing, title },
		})
	},
)

type EndSessionArgs = { sessionId: string; exitCode: number | null }

export const endSessionAtom = atom(
	null,
	(get, set, { sessionId, exitCode }: EndSessionArgs) => {
		const sessions = get(sessionsAtom)
		const existing = sessions[sessionId]
		if (!existing) return
		set(sessionsAtom, {
			...sessions,
			[sessionId]: { ...existing, status: 'ended', exitCode },
		})
	},
)

type CellFramesMap = Readonly<Record<string, CellFramePayload>>

// The single global home for the latest cell frame per session. A pane that
// remounts reads the last frame from here instead of racing a per-pane
// agent:cells listen, so it repaints immediately rather than staying blank
// until the next live frame.
export const cellFramesAtom = atom<CellFramesMap>({})

export const setCellFrameAtom = atom(
	null,
	(get, set, frame: CellFramePayload) => {
		set(cellFramesAtom, {
			...get(cellFramesAtom),
			[frame.session_id]: frame,
		})
	},
)

// Which session currently owns the keyboard. Decoupled from DOM focus on
// purpose: the terminal is the app's centre of gravity, so keystrokes flow to
// the active pane without a click-to-focus step. With a single pane it's just
// that pane; once Ghostty-style splits land, focus-follows-mouse keeps exactly
// one pane active so the keystroke is never broadcast to every terminal.
export const activeSessionIdAtom = atom<string | null>(null)

// A pane claims the keyboard when it mounts or the pointer enters it.
export const claimActiveSessionAtom = atom(
	null,
	(_get, set, sessionId: string) => {
		set(activeSessionIdAtom, sessionId)
	},
)

// A pane releases the keyboard on unmount — but only if it's still the active
// one, so a sibling pane that already claimed focus isn't wrongly cleared.
export const releaseActiveSessionAtom = atom(
	null,
	(get, set, sessionId: string) => {
		if (get(activeSessionIdAtom) === sessionId) {
			set(activeSessionIdAtom, null)
		}
	},
)
