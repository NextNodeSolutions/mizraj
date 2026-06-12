import { PlansMenu } from './PlansMenu'
import { PlanView } from './PlanView'

type Props = {
	activeProjectPath: string | null
}

/**
 * The Plans screen: the repo's interviews and plans on the left, the
 * selected document on the right. Selection is the URL — deep links and the
 * command palette land here with a document already open.
 */
export const PlansView = ({
	activeProjectPath,
}: Props): React.JSX.Element => (
	<section className="plans" aria-label="Plans">
		<div className="plans__list">
			<PlansMenu repoPath={activeProjectPath} />
		</div>
		<div className="plans__doc">
			<PlanView />
		</div>
	</section>
)
