import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { NewTerminalButton } from '@/features/sessions/NewTerminalButton'
import { RunAgentButton } from '@/features/sessions/RunAgentButton'

import {
	matchMissionControlRoute,
	matchPipelineRoute,
	matchPlanRoute,
	matchPlansIndexRoute,
	matchTasksRoute,
	missionControlHref,
	navigate,
	pipelineHref,
	plansIndexHref,
	tasksHref,
	usePathname,
} from './router'

type NavItem = {
	label: string
	href: string
	isActive: (pathname: string) => boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
	{
		label: 'Mission Control',
		href: missionControlHref(),
		isActive: matchMissionControlRoute,
	},
	{ label: 'Pipeline', href: pipelineHref(), isActive: matchPipelineRoute },
	{
		label: 'Plans',
		href: plansIndexHref(),
		isActive: pathname =>
			matchPlansIndexRoute(pathname) || matchPlanRoute(pathname) !== null,
	},
	{ label: 'Tasks', href: tasksHref(), isActive: matchTasksRoute },
]

type Props = {
	activeProjectPath: string | null
	onSelectProject: (path: string) => void
	onOpenSettings: () => void
}

export const TopBar = ({
	activeProjectPath,
	onSelectProject,
	onOpenSettings,
}: Props): React.JSX.Element => {
	const pathname = usePathname()

	return (
		<header className="top-bar">
			<button
				type="button"
				className="top-bar__brand"
				onClick={() => navigate(missionControlHref())}
			>
				<span className="top-bar__glyph" aria-hidden="true">
					M
				</span>
				<h1>Mizraj</h1>
			</button>
			<nav className="top-bar__nav" aria-label="Screens">
				{NAV_ITEMS.map(item => (
					<a
						key={item.href}
						className="top-bar__nav-link"
						href={item.href}
						aria-current={
							item.isActive(pathname) ? 'page' : undefined
						}
						onClick={event => {
							event.preventDefault()
							navigate(item.href)
						}}
					>
						{item.label}
					</a>
				))}
			</nav>
			<div className="top-bar__actions">
				<ProjectPicker
					activeProjectPath={activeProjectPath}
					onSelect={onSelectProject}
				/>
				{activeProjectPath !== null && (
					<>
						<RunAgentButton repoPath={activeProjectPath} />
						<NewTerminalButton repoPath={activeProjectPath} />
					</>
				)}
				<button
					type="button"
					className="settings-trigger"
					aria-label="Open settings"
					onClick={onOpenSettings}
				>
					⚙
				</button>
			</div>
		</header>
	)
}
