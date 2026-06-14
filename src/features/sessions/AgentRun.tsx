import { DiffPanel } from '@/features/diff/DiffPanel'
import { repoHeadLabel, useRepoHead } from '@/features/projects/repoHead'
import { pushToast } from '@/shared/toasts'
import { SDot } from '@/shared/ui/atoms'

import { closeSession } from './closeSession'
import { CockpitSessions } from './CockpitSessions'
import { sessionDotKind } from './displayStatus'
import { contextLabel, sessionLabel } from './sessionLabel'
import type { SessionState } from './sessions'
import { SplitTreeView } from './SplitTreeView'
import { useSession } from './useSession'

type Props = {
	sessionId: string
	activeProjectPath: string | null
}

const stopSession = (sessionId: string): void => {
	void closeSession(sessionId).then(ok => {
		if (ok) pushToast('Session stopped')
	})
}

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
