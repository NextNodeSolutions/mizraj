import { useEffect, useState } from 'react'

import './App.css'
import PlansMenu from '@/features/plans/PlansMenu'
import { useActiveProject } from '@/features/projects/activeProject'
import ProjectPicker from '@/features/projects/ProjectPicker'
import RunAgentButton from '@/features/sessions/RunAgentButton'
import SessionSidebar from '@/features/sessions/SessionSidebar'
import { useSessions } from '@/features/sessions/useSessions'
import { useSettings } from '@/features/settings/settings'
import SettingsPanel from '@/features/settings/SettingsPanel'

import MainContent from './MainContent'
import { matchAgentRunRoute, navigate, tasksHref, usePathname } from './router'

const activeSessionsLabel = (count: number): string =>
	`${count} active ${count === 1 ? 'session' : 'sessions'}`

function App(): React.JSX.Element {
	const settings = useSettings()
	const activeProjectPath = useActiveProject(settings.lastProjectPath)
	const [panelOpen, setPanelOpen] = useState(false)
	const pathname = usePathname()
	const agentRunRoute = matchAgentRunRoute(pathname)
	const sessions = useSessions()
	const activeSessionCount = sessions.filter(
		session => session.status === 'running',
	).length

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<header className="top-bar">
				<div className="top-bar__brand">
					<h1>Mizraj</h1>
					<span className="top-bar__session-count" role="status">
						{activeSessionsLabel(activeSessionCount)}
					</span>
				</div>
				<div className="top-bar__actions">
					<ProjectPicker onSelect={settings.setLastProjectPath} />
					{activeProjectPath !== null && (
						<RunAgentButton repoPath={activeProjectPath} />
					)}
					<button
						type="button"
						className="settings-trigger"
						aria-label="Open settings"
						onClick={() => setPanelOpen(true)}
					>
						⚙
					</button>
				</div>
			</header>
			<div className="layout">
				<aside className="sidebar" aria-label="Sidebar">
					<nav className="sidebar-nav" aria-label="Views">
						<a
							className="sidebar-nav__link"
							href={tasksHref()}
							onClick={event => {
								event.preventDefault()
								navigate(tasksHref())
							}}
						>
							Tasks
						</a>
					</nav>
					<SessionSidebar
						activeSessionId={agentRunRoute?.sessionId ?? null}
					/>
					<PlansMenu repoPath={activeProjectPath} />
				</aside>
				<section className="main-content">
					<MainContent activeProjectPath={activeProjectPath} />
				</section>
			</div>
			<SettingsPanel
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
				settings={settings}
			/>
		</main>
	)
}

export default App
