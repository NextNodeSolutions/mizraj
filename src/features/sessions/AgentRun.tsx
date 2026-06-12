import { invoke } from '@tauri-apps/api/core'

import { navigate, reviewHref } from '@/app/router'
import { DiffPanel } from '@/features/diff/DiffPanel'
import { BranchChip } from '@/features/projects/BranchChip'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import { CockpitSessions } from './CockpitSessions'
import { sessionDisplayStatus } from './displayStatus'
import { sessionLabel } from './sessionLabel'
import { SplitTreeView } from './SplitTreeView'
import { useSession } from './useSession'

type Props = {
	sessionId: string
}

const stopSession = (sessionId: string): void => {
	invoke('session_close', { sessionId }).catch((error: unknown) => {
		const { message, stack } = describeError(error)
		logger.error(`AgentRun: session_close failed: ${message}`, {
			scope: 'agent-run',
			details: { stack, sessionId },
		})
	})
}

export const AgentRun = ({ sessionId }: Props): React.JSX.Element => {
	const session = useSession(sessionId)
	const ended = session?.status === 'ended'

	return (
		<div className="cockpit">
			<CockpitSessions activeSessionId={sessionId} />
			<div className="cockpit__stage">
				<div className="cockpit__tab-bar">
					<span className="cockpit__tab">
						{session && (
							<span
								className="status-dot"
								data-status={sessionDisplayStatus(session)}
							/>
						)}
						{session ? sessionLabel(session) : sessionId}
						{ended && session.exitCode !== null && (
							<span className="cockpit__exit">
								exit {session.exitCode}
							</span>
						)}
					</span>
					<BranchChip repoPath={session?.repoPath ?? null} />
					<button
						type="button"
						className="cockpit__stop"
						onClick={() => stopSession(sessionId)}
						disabled={ended}
					>
						◼ Stop
					</button>
				</div>
				<div className="cockpit__terminal">
					<SplitTreeView rootId={sessionId} />
				</div>
			</div>
			<aside className="cockpit__diffs" aria-label="Diffs">
				<DiffPanel repoPath={session?.repoPath ?? null}>
					<button
						type="button"
						className="cockpit__open-review"
						onClick={() => navigate(reviewHref())}
					>
						Open review ↗
					</button>
				</DiffPanel>
			</aside>
		</div>
	)
}
