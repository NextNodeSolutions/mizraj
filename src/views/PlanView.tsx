import PlanPanel from '../components/PlanPanel'
import type { PlanRoute } from '../router'
import { matchPlanRoute, usePathname } from '../router'

const planUrl = ({ kind, slug }: PlanRoute): string =>
	`plan://localhost/${kind}/${slug}/plan.html`

const planKey = ({ kind, slug }: PlanRoute): string => `${kind}/${slug}`

const PlanView = (): React.JSX.Element => {
	const pathname = usePathname()
	const route = matchPlanRoute(pathname)
	if (!route) {
		return (
			<p className="plan-view__empty">
				Select a plan from the sidebar.
			</p>
		)
	}
	const key = planKey(route)
	return <PlanPanel key={key} src={planUrl(route)} title={key} />
}

export default PlanView
