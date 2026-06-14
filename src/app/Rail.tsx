import { useCockpitTargetHref } from '@/features/sessions/cockpitTarget'
import { sessionDisplayStatus } from '@/features/sessions/displayStatus'
import { useSessions } from '@/features/sessions/useSessions'

import { navigate, usePathname } from './router'
import { shellViews } from './shellViews'

export const Rail = (): React.JSX.Element => {
	const pathname = usePathname()
	const cockpitHref = useCockpitTargetHref()
	const sessions = useSessions()
	const reviewCount = sessions.filter(
		session => sessionDisplayStatus(session) === 'review',
	).length

	return (
		<nav className="mz-rail" aria-label="Views">
			{shellViews(cockpitHref).map(view => {
				// The review badge is the one dynamic adornment; every other
				// view renders the registry entry verbatim.
				const badge = view.id === 'review' ? reviewCount : 0
				return (
					<button
						key={view.id}
						type="button"
						className="mz-railbtn"
						data-on={view.isActive(pathname) ? 'true' : 'false'}
						aria-label={view.label}
						onClick={() => navigate(view.href)}
					>
						{badge > 0 && (
							<span className="rail-badge">{badge}</span>
						)}
						{view.icon}
						<span className="rl">{view.label}</span>
					</button>
				)
			})}
		</nav>
	)
}
