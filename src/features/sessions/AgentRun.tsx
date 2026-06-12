import { invoke } from '@tauri-apps/api/core'

import { DiffPanel } from '@/features/diff/DiffPanel'
import { repoHeadLabel, useRepoHead } from '@/features/projects/repoHead'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { pushToast } from '@/shared/toasts'
import { SDot } from '@/shared/ui/atoms'

import { CockpitSessions, sessionDotKind } from './CockpitSessions'
import { sessionLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { SplitTreeView } from './SplitTreeView'
import { useSession } from './useSession'

type Props = {
	sessionId: string
	activeProjectPath: string | null
}

const stopSession = (sessionId: string): void => {
	invoke('session_close', { sessionId })
		.then(() => pushToast('Session stopped'))
		.catch((error: unknown) => {
			const { message, stack } = describeError(error)
			logger.error(`AgentRun: session_close failed: ${message}`, {
				scope: 'agent-run',
				details: { stack, sessionId },
			})
		})
}

const binaryBasename = (binary: string): string =>
	binary.split('/').pop() ?? binary

// TODO(backend): load_ghostty_config DTO (src-tauri/src/ghostty/dto.rs) exposes resolved colors but not the theme name. Render 'ghostty · {basename(session.binary)}' until the name field is added.
const contextLabel = (session: SessionState): string =>
	`ghostty · ${binaryBasename(session.binary)}`

type TermTabProps = {
	session: SessionState | undefined
	sessionId: string
}

// One pill merges the status dot, the branch of the session's repo (HEAD of
// the active project — the standalone BranchChip folded in here) and the
// exit-code suffix; the session label stands in while the head is unknown.
const TermTab = ({ session, sessionId }: TermTabProps): React.JSX.Element => {
	const head = useRepoHead(session?.repoPath ?? null)
	const label =
		session === undefined
			? sessionId
			: head.status === 'ready'
				? repoHeadLabel(head.data)
				: sessionLabel(session)

	return (
		<span className="fc-term-tab">
			{session && <SDot s={sessionDotKind(session)} />}
			{label}
			{session?.status === 'ended' && session.exitCode !== null && (
				<span className="fc-term-exit">exit {session.exitCode}</span>
			)}
		</span>
	)
}

export const AgentRun = ({
	sessionId,
	activeProjectPath,
}: Props): React.JSX.Element => {
	const session = useSession(sessionId)
	const ended = session?.status === 'ended'

	return (
		<div className="fc-wrap stagger">
			<CockpitSessions
				activeSessionId={sessionId}
				activeProjectPath={activeProjectPath}
			/>
			<div className="term fc-term">
				<div className="fc-term-bar">
					<TermTab session={session} sessionId={sessionId} />
					{session && (
						<span className="fc-cwd">{contextLabel(session)}</span>
					)}
					<span className="mz-spacer" />
					<button
						type="button"
						className="btn btn-sm btn-ghost"
						style={{ color: 'var(--ctp-subtext0)' }}
						onClick={() => stopSession(sessionId)}
						disabled={ended}
					>
						◼ Stop
					</button>
				</div>
				<div className="fc-term-body">
					<SplitTreeView rootId={sessionId} />
				</div>
			</div>
			<DiffPanel repoPath={session?.repoPath ?? null} />
		</div>
	)
}
