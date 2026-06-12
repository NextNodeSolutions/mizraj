import { pushToast } from '@/shared/toasts'
import { Panel, PanelHead } from '@/shared/ui/atoms'
import { IconPlus } from '@/shared/ui/icons'

import { PlansMenu } from './PlansMenu'
import { PlanView } from './PlanView'

const requestNewInterview = (): void => {
	// TODO: no create_interview command; interviews are produced by the agent workflow (docs/interviews/<slug>/)
	pushToast('New interview — Claude asks, you answer, a plan comes out')
}

type Props = {
	activeProjectPath: string | null
}

/**
 * The Plans screen: the repo's interviews and plans on the left, the
 * selected document on the right. Selection is the URL — deep links and the
 * command palette land here with a document already open.
 */
export const PlansView = ({ activeProjectPath }: Props): React.JSX.Element => (
	<section className="pl-wrap stagger" aria-label="Plans">
		<Panel className="pl-list-panel">
			<PanelHead title="Plans & interviews">
				<button
					type="button"
					className="mz-iconbtn"
					aria-label="New interview"
					onClick={requestNewInterview}
				>
					<IconPlus />
				</button>
			</PanelHead>
			<PlansMenu repoPath={activeProjectPath} />
		</Panel>
		<Panel className="pl-doc-panel">
			<PlanView />
		</Panel>
	</section>
)
