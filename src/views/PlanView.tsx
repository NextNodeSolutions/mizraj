import PlanPanel from '../components/PlanPanel'
import type { PlanRoute } from '../router'
import { matchPlanRoute, usePathname } from '../router'

const planUrl = ({ kind, slug }: PlanRoute): string =>
	`plan://localhost/${kind}/${slug}/plan.html`

const PlanView = (): React.JSX.Element | null => {
	const pathname = usePathname()
	const route = matchPlanRoute(pathname)
	if (!route) return null
	return (
		<PlanPanel
			src={planUrl(route)}
			title={`${route.kind}/${route.slug}`}
		/>
	)
}

export default PlanView
