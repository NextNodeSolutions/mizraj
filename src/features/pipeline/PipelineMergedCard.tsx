import {
	sessionLabel,
	sessionRepoLabel,
} from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'

type Props = {
	session: SessionState
	/** Just approved — mounts with the spring entrance. */
	fresh?: boolean
}

/** A session approved from Review, parked in Done with its merged note. */
export const PipelineMergedCard = ({
	session,
	fresh = false,
}: Props): React.JSX.Element => {
	const repoLabel = sessionRepoLabel(session)

	return (
		<article
			className="pipeline__card"
			data-done="true"
			data-anim={fresh ? 'in' : undefined}
		>
			<div className="pipeline__card-row">
				<span className="tag">merged</span>
				{repoLabel !== null && (
					<span className="pipeline__branch">{repoLabel}</span>
				)}
			</div>
			<p className="pipeline__title">{sessionLabel(session)}</p>
			<p className="pipeline__done-note">✓ merged into main</p>
		</article>
	)
}
